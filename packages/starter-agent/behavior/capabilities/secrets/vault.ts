/**
 * Macro's vault API, the agent routes: one function per route, each
 * answering the parsed value or the code the vault refused with. Nothing here
 * throws for a refusal, and nothing it returns on failure holds anything the
 * vault sent: an answer that isn't the expected shape is `unexpected`, not a
 * parse error quoting it.
 */
import type { Clock } from '@macro-inc/muppet/utilities/time';
import type { z } from 'zod';
import { busy } from './config.ts';
import {
  AccessRequestState,
  type AgentEditableMetadata,
  agentBase,
  Disclosed,
  ErrorBody,
  type ErrorCode,
  headers,
  type ItemSecret,
  type ItemSecretPatch,
  type Permission,
  purpose,
  SearchPage,
  type SecretSelector,
  TotpCode,
  Written,
} from './wire.ts';

/** Where the vault is (the storage service's host), and the key to present there. */
export type Endpoint = { readonly origin: string; readonly key: string };

export type VaultPorts = {
  readonly fetch: (request: Request) => Promise<Response>;
  /** In a script's process, the relay's storage address and capability; the relay adds the real key. */
  readonly endpoint: () => Promise<Endpoint>;
  /** The agent's team. */
  readonly team: () => Promise<string>;
  /** The wake this call belongs to, a UUIDv7. */
  readonly wakeId: () => string;
  /** A fresh UUIDv7 for a write, reused across its retries. */
  readonly operationId: () => string;
  readonly clock: Pick<Clock, 'sleep'>;
  /** A number in [0, 1), for spreading retries. */
  readonly jitter: () => number;
};

/** A refusal: the vault's code, or `unexpected` (an answer it couldn't read) or `unreachable`. */
export type Refusal = ErrorCode | 'unexpected' | 'unreachable';

export type Answer<Value> =
  | {
      readonly kind: 'ok';
      readonly status: number;
      readonly value: Value;
      readonly wake: string;
    }
  | {
      readonly kind: 'refused';
      readonly code: Refusal;
      readonly wake: string;
      /** How long to wait before asking again, on a busy or rate-limited refusal. */
      readonly retryAfterMs?: number;
    };

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

const item = (teamId: string, itemId: string): string =>
  `${agentBase(teamId)}/items/${encodeURIComponent(itemId)}`;

export const vault = (ports: VaultPorts) => {
  const once = async (
    method: Method,
    path: string,
    wake: string,
    body: unknown
  ): Promise<
    | {
        readonly kind: 'answered';
        readonly status: number;
        readonly json: unknown;
      }
    | { readonly kind: 'unreachable' }
  > => {
    const { origin, key } = await ports.endpoint();
    const sent = new Headers({ [headers.key]: key, [headers.wake]: wake });
    if (method !== 'GET') sent.set(headers.mutation, '1');
    if (body !== undefined) sent.set('content-type', 'application/json');
    try {
      const response = await ports.fetch(
        new Request(`${origin.replace(/\/+$/, '')}${path}`, {
          method,
          headers: sent,
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      );
      const text = await response.text();
      const json: unknown = (() => {
        try {
          return text === '' ? undefined : JSON.parse(text);
        } catch {
          return undefined;
        }
      })();
      return { kind: 'answered', status: response.status, json };
    } catch {
      return { kind: 'unreachable' };
    }
  };

  const call = async <Value>(
    method: Method,
    path: string,
    schema: z.ZodType<Value> | undefined,
    body?: unknown
  ): Promise<Answer<Value | undefined>> => {
    const wake = ports.wakeId();
    for (let attempt = 0; ; attempt += 1) {
      const answered = await once(method, path, wake, body);
      if (answered.kind === 'unreachable')
        return { kind: 'refused', code: 'unreachable', wake };
      const { status, json } = answered;
      if (status >= 200 && status < 300) {
        if (schema === undefined)
          return { kind: 'ok', status, value: undefined, wake };
        const parsed = schema.safeParse(json);
        return parsed.success
          ? { kind: 'ok', status, value: parsed.data, wake }
          : { kind: 'refused', code: 'unexpected', wake };
      }
      const error = ErrorBody.safeParse(json);
      if (!error.success) return { kind: 'refused', code: 'unexpected', wake };
      const { code, retryAfterMs } = error.data;
      if (code !== 'vault_busy' || attempt >= busy.retries)
        return {
          kind: 'refused',
          code,
          wake,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        };
      const wait = retryAfterMs ?? busy.firstWaitMs * 2 ** attempt;
      await ports.clock.sleep(Math.round(wait * (1 + ports.jitter())));
    }
  };

  /** `call` for a route that always answers a body. */
  const read = async <Value>(
    method: Method,
    path: string,
    schema: z.ZodType<Value>,
    body?: unknown
  ): Promise<Answer<Value>> => {
    const answer = await call(method, path, schema, body);
    if (answer.kind === 'refused') return answer;
    return answer.value === undefined
      ? { kind: 'refused', code: 'unexpected', wake: answer.wake }
      : { ...answer, value: answer.value };
  };

  return {
    team: ports.team,
    search: (
      teamId: string,
      { query, limit }: { readonly query: string; readonly limit: number }
    ) => {
      const search = new URLSearchParams();
      if (query !== '') search.set('q', query);
      search.set('limit', String(limit));
      return read('GET', `${agentBase(teamId)}/items?${search}`, SearchPage);
    },
    /** One field's value, for the clipboard: the only purpose v1 has. */
    disclose: (
      teamId: string,
      itemId: string,
      {
        selector,
        expectedVersion,
      }: {
        readonly selector: SecretSelector;
        readonly expectedVersion?: number;
      }
    ) =>
      read('POST', `${item(teamId, itemId)}/disclose`, Disclosed, {
        selector,
        purpose,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      }),
    totpCode: (teamId: string, itemId: string) =>
      read('POST', `${item(teamId, itemId)}/totp/code`, TotpCode, { purpose }),
    create: (
      teamId: string,
      input: {
        readonly name: string;
        readonly url: string | null;
        readonly secret: ItemSecret;
      }
    ) =>
      read('POST', `${agentBase(teamId)}/items`, Written, {
        operationId: ports.operationId(),
        ...input,
      }),
    update: (
      teamId: string,
      itemId: string,
      input: {
        readonly expectedVersion: number;
        readonly secretPatch?: ItemSecretPatch;
        readonly metadataPatch?: AgentEditableMetadata;
      }
    ) =>
      read('PATCH', item(teamId, itemId), Written, {
        operationId: ports.operationId(),
        ...input,
      }),
    requestAccess: (teamId: string, itemId: string, permission: Permission) =>
      read(
        'POST',
        `${item(teamId, itemId)}/access-requests`,
        AccessRequestState,
        { permission }
      ),
    mine: (teamId: string, itemId: string) =>
      read(
        'GET',
        `${item(teamId, itemId)}/access-requests/mine`,
        AccessRequestState
      ),
  };
};

export type Vault = ReturnType<typeof vault>;
