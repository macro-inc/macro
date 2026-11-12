/**
 * A stand-in for Macro's vault API (the agent routes of the "Vault API
 * contract"): the same routes, statuses, camelCase JSON and error
 * precedence, over memory, as a fetch handler a test hands the client. The
 * owner's side (sharing, approving, denying, revoking) is plain functions,
 * since the agent never calls it.
 *
 * Precedence, for every agent route: the key (401 unauthorized), the wake id
 * (400 invalid_session_attribution), the feature flags (404 not_found, as the
 * human routes answer a flag that is off), the team (403 invalid_agent), the
 * mutation header (400 invalid_request), the route and body (404 / 400), the
 * item (404 not_found, also for a person's private item), then access:
 * usable, else pending (a live request, or a shared grant without approval;
 * never for an item the agent created), else not_granted; then forbidden and
 * version_conflict.
 *
 * Items are the team's, shared with it (the default) or private to the
 * person who made it; the creator never changes. A share with the team
 * grants an agent nothing: only an Agent grant does, which needs the
 * owner's standing approval unless the agent created the item.
 */
import type { Clock } from '@macro-inc/muppet/utilities/time';
import { isoText } from '@macro-inc/muppet/utilities/time';
import { z } from 'zod';
import { totp } from '../../tools/totp.ts';
import { attributionProblem, wakeInstant } from '../attribution.ts';
import {
  type AccessRequestState,
  AgentEditableMetadata,
  type AgentItemAccess,
  type AgentSearchHit,
  type ErrorCode,
  headers,
  ItemKind,
  ItemSecret,
  ItemSecretPatch,
  kindOfSecret,
  Permission,
  patched,
  type RequestStatus,
  SecretSelector,
  selected,
} from '../wire.ts';

type Item = {
  readonly id: string;
  readonly teamId: string;
  name: string;
  readonly kind: ItemKind;
  url: string | null;
  secret: ItemSecret;
  version: number;
  /** Whether this agent created it. */
  readonly creator: boolean;
  /** Shared with the team, or private to the person who made it. */
  readonly share: 'team' | 'private';
  totpSeed?: string;
};

type Grant = { permission: Permission; approved: boolean };

type Request = {
  requestId: string;
  permission: Permission;
  status: Exclude<RequestStatus, 'none'>;
  revision: number;
  updatedAt: Temporal.Instant;
};

type Written = { readonly status: number; readonly body: unknown };

export type Call = {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The request body as sent, so a test can see a value did go to the vault. */
  readonly body: string;
};

const json = (status: number, body: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
    },
  });

const statusOf: Record<ErrorCode, number> = {
  unauthorized: 401,
  invalid_agent: 403,
  invalid_session_attribution: 400,
  not_found: 404,
  not_granted: 403,
  pending: 403,
  forbidden: 403,
  invalid_request: 400,
  version_conflict: 409,
  vault_busy: 409,
  vault_unavailable: 503,
};

const refuse = (code: ErrorCode, retryAfterMs?: number): Response =>
  json(statusOf[code], {
    code,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });

const UuidV7 = z.string().refine((id) => wakeInstant(id) !== undefined);

const Disclose = z.strictObject({
  selector: SecretSelector,
  purpose: z.enum(['copy', 'type']),
  expectedVersion: z.number().int().optional(),
});
const Code = z.strictObject({ purpose: z.enum(['copy', 'type']) });
const Create = z.strictObject({
  operationId: UuidV7,
  name: z.string().min(1).max(200),
  kind: ItemKind,
  url: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  secret: ItemSecret,
});
const Patch = z.strictObject({
  operationId: UuidV7,
  expectedVersion: z.number().int(),
  secretPatch: ItemSecretPatch.optional(),
  metadataPatch: AgentEditableMetadata.optional(),
});
const SetTotp = z.strictObject({
  operationId: UuidV7,
  expectedVersion: z.number().int(),
  seed: z.string().min(1),
});
const Ask = z.strictObject({ permission: Permission });

const mutations = new Set(['POST', 'PATCH', 'PUT']);
const route = /\/passwords\/agent\/teams\/([^/]+)(\/.*)?$/;

export const stubVault = ({
  clock,
  teamId,
  agentKey,
  agentAccountId = 'macro|agent@example.com',
}: {
  readonly clock: Pick<Clock, 'now'>;
  readonly teamId: string;
  /** The key the vault takes as the agent's. */
  readonly agentKey: string;
  readonly agentAccountId?: string;
}) => {
  const items = new Map<string, Item>();
  const grants = new Map<string, Grant>();
  const requests = new Map<string, Request>();
  const revisions = new Map<string, number>();
  const operations = new Map<string, Written>();
  const calls: Call[] = [];
  const flags = { enabled: true, busy: 0 };
  let counter = 0;
  const newId = () => {
    counter += 1;
    return `00000000-0000-4000-8000-${counter.toString().padStart(12, '0')}`;
  };

  const bump = (itemId: string) =>
    revisions.set(itemId, (revisions.get(itemId) ?? 0) + 1);

  const live = (itemId: string): Request | undefined => {
    const request = requests.get(itemId);
    return request?.status === 'pending' ? request : undefined;
  };

  // The contract's shared policy: G and (C or A).
  const access = (item: Item): AgentItemAccess => {
    const grant = grants.get(item.id);
    const usable =
      grant !== undefined && (item.creator || grant.approved === true);
    // A request on an item the agent created is only the request's own status, never the item's.
    const pending = item.creator ? undefined : live(item.id);
    return {
      status: usable
        ? 'usable'
        : pending === undefined
          ? 'request_access'
          : 'pending',
      useBasis: !usable
        ? null
        : item.creator
          ? 'creator_grant'
          : 'approved_grant',
      canUpdate: usable && grant?.permission === 'edit',
      canSetTotp: item.creator && grant?.permission === 'edit',
      permissionRevision: revisions.get(item.id) ?? 0,
      pendingRequestId: pending?.requestId ?? null,
    };
  };

  /** Why `item` can't be used, or undefined if it can. */
  const unusable = (item: Item): ErrorCode | undefined => {
    if (access(item).status === 'usable') return undefined;
    if (item.creator) return 'not_granted';
    const grant = grants.get(item.id);
    const awaitingApproval = grant !== undefined && !grant.approved;
    return live(item.id) !== undefined || awaitingApproval
      ? 'pending'
      : 'not_granted';
  };

  const hit = (item: Item): AgentSearchHit => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    url: item.url,
    version: item.version,
    access: access(item),
  });

  const requestState = (item: Item): AccessRequestState => {
    const request = requests.get(item.id);
    return request === undefined
      ? {
          requestId: null,
          itemId: item.id,
          agentAccountId,
          permission: null,
          status: 'none',
          revision: 0,
          access: access(item),
          updatedAt: null,
        }
      : {
          requestId: request.requestId,
          itemId: item.id,
          agentAccountId,
          permission: request.permission,
          status: request.status,
          revision: request.revision,
          access: access(item),
          updatedAt: isoText(request.updatedAt),
        };
  };

  const body = async (request: globalThis.Request): Promise<unknown> => {
    try {
      return await request.json();
    } catch {
      return undefined;
    }
  };

  const once = (operationId: string, write: () => Written): Response => {
    const done = operations.get(operationId);
    if (done !== undefined)
      return json(done.status === 201 ? 200 : done.status, done.body);
    const result = write();
    if (result.status < 300) operations.set(operationId, result);
    return json(result.status, result.body);
  };

  /** Whether the agent's team can see an item at all: a person's private item is theirs alone. */
  const visible = (item: Item): boolean =>
    item.teamId === teamId && (item.share === 'team' || item.creator);

  const handle = async (request: globalThis.Request): Promise<Response> => {
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.clone().text();
    calls.push({
      method: request.method,
      path: url.pathname + url.search,
      headers: Object.fromEntries(request.headers),
      body: text,
    });
    if (request.headers.get(headers.key) !== agentKey)
      return refuse('unauthorized');
    if (
      attributionProblem(request.headers.get(headers.wake), clock.now()) !==
      undefined
    )
      return refuse('invalid_session_attribution');
    if (!flags.enabled) return refuse('not_found');
    const matched = route.exec(url.pathname);
    if (matched === null) return refuse('not_found');
    const [, team = '', rest = ''] = matched;
    if (decodeURIComponent(team) !== teamId) return refuse('invalid_agent');
    if (
      mutations.has(request.method) &&
      request.headers.get(headers.mutation) !== '1'
    )
      return refuse('invalid_request');
    if (flags.busy > 0) {
      flags.busy -= 1;
      return refuse('vault_busy', 10);
    }
    const parts = rest.split('/').filter((part) => part !== '');
    const method = request.method;

    if (parts.length === 1 && parts[0] === 'items' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '50');
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        return refuse('invalid_request');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const start = Number(url.searchParams.get('cursor') ?? '0');
      const found = [...items.values()].filter(
        (item) => visible(item) && item.name.toLowerCase().includes(q)
      );
      const page = found.slice(start, start + limit);
      return json(200, {
        items: page.map(hit),
        nextCursor: start + limit < found.length ? String(start + limit) : null,
      });
    }

    if (parts.length === 1 && parts[0] === 'items' && method === 'POST') {
      const parsed = Create.safeParse(await body(request));
      if (!parsed.success) return refuse('invalid_request');
      const input = parsed.data;
      if (kindOfSecret(input.secret) !== input.kind)
        return refuse('invalid_request');
      return once(input.operationId, () => {
        const item: Item = {
          id: newId(),
          teamId,
          name: input.name,
          kind: input.kind,
          url: input.url ?? null,
          secret: input.secret,
          version: 1,
          creator: true,
          share: 'team',
        };
        items.set(item.id, item);
        // Creation grants the creator Edit, needing no approval.
        grants.set(item.id, { permission: 'edit', approved: false });
        bump(item.id);
        return {
          status: 201,
          body: { item: hit(item), version: item.version },
        };
      });
    }

    if (parts[0] !== 'items' || parts[1] === undefined)
      return refuse('not_found');
    const itemId = decodeURIComponent(parts[1]);
    const action = parts.slice(2).join('/');
    const known = new Set([
      'GET:access-requests/mine',
      'POST:access-requests',
      'POST:disclose',
      'POST:totp/code',
      'PUT:totp',
      'PATCH:',
    ]);
    if (!known.has(`${method}:${action}`)) return refuse('not_found');
    const input = method === 'GET' ? undefined : await body(request);
    const schema =
      action === 'disclose'
        ? Disclose
        : action === 'totp/code'
          ? Code
          : action === 'totp'
            ? SetTotp
            : action === 'access-requests'
              ? Ask
              : action === ''
                ? Patch
                : undefined;
    if (schema !== undefined && !schema.safeParse(input).success)
      return refuse('invalid_request');
    const item = items.get(itemId);
    if (item === undefined || !visible(item)) return refuse('not_found');

    if (action === 'access-requests/mine') return json(200, requestState(item));

    if (action === 'access-requests') {
      const permission = Ask.parse(input).permission;
      if (access(item).status === 'usable')
        return json(200, requestState(item));
      if (live(item.id) === undefined) {
        const previous = requests.get(item.id);
        requests.set(item.id, {
          requestId: newId(),
          permission,
          status: 'pending',
          revision: (previous?.revision ?? 0) + 1,
          updatedAt: clock.now(),
        });
      }
      return json(202, requestState(item));
    }

    const why = unusable(item);
    if (why !== undefined) return refuse(why);

    if (action === 'disclose') {
      const { selector, expectedVersion } = Disclose.parse(input);
      const value = selected(item.secret, selector);
      if (value === undefined) return refuse('invalid_request');
      if (expectedVersion !== undefined && expectedVersion !== item.version)
        return refuse('version_conflict');
      return json(200, { value, version: item.version, selector });
    }

    if (action === 'totp/code') {
      if (item.totpSeed === undefined) return refuse('invalid_request');
      const now = clock.now();
      const period = 30;
      const window = Math.floor(now.epochMilliseconds / 1000 / period);
      return json(200, {
        code: await totp(item.totpSeed, now),
        expiresAt: isoText(
          Temporal.Instant.fromEpochMilliseconds((window + 1) * period * 1000)
        ),
        periodSeconds: period,
      });
    }

    if (action === 'totp') {
      const { operationId, expectedVersion, seed } = SetTotp.parse(input);
      if (!access(item).canSetTotp) return refuse('forbidden');
      if (expectedVersion !== item.version) return refuse('version_conflict');
      return once(operationId, () => {
        item.totpSeed = seed;
        item.version += 1;
        return { status: 204, body: undefined };
      });
    }

    const { operationId, expectedVersion, secretPatch, metadataPatch } =
      Patch.parse(input);
    if (!access(item).canUpdate) return refuse('forbidden');
    if (secretPatch !== undefined && kindOfSecret(secretPatch) !== item.kind)
      return refuse('invalid_request');
    return once(operationId, () => {
      if (expectedVersion !== item.version)
        return { status: 409, body: { code: 'version_conflict' } };
      if (secretPatch !== undefined)
        item.secret = patched(item.secret, secretPatch);
      if (metadataPatch?.name !== undefined) item.name = metadataPatch.name;
      if (metadataPatch?.url !== undefined) item.url = metadataPatch.url;
      item.version += 1;
      return { status: 200, body: { item: hit(item), version: item.version } };
    });
  };

  const resolve = (
    itemId: string,
    status: 'approved' | 'denied' | 'revoked'
  ) => {
    const request = requests.get(itemId);
    if (request === undefined) return;
    request.status = status;
    request.revision += 1;
    request.updatedAt = clock.now();
  };

  return {
    fetch: handle,
    calls,
    flags,
    /** An item someone else made: shared with the agent only if the owner does so. */
    add: (item: {
      readonly name: string;
      readonly kind: ItemKind;
      readonly url?: string;
      readonly secret: ItemSecret;
      readonly totpSeed?: string;
      readonly teamId?: string;
      readonly share?: 'team' | 'private';
    }): string => {
      const id = newId();
      items.set(id, {
        id,
        teamId: item.teamId ?? teamId,
        name: item.name,
        kind: item.kind,
        url: item.url ?? null,
        secret: item.secret,
        version: 1,
        creator: false,
        share: item.share ?? 'team',
        totpSeed: item.totpSeed,
      });
      return id;
    },
    secretOf: (itemId: string): ItemSecret | undefined =>
      items.get(itemId)?.secret,
    owner: {
      /** Grants the agent an item without the standing approval its first use needs. */
      share: (itemId: string, permission: Permission) => {
        grants.set(itemId, { permission, approved: false });
        bump(itemId);
      },
      /** Approves the agent's request: the permission and the standing approval, together. */
      approve: (itemId: string, permission: Permission) => {
        grants.set(itemId, { permission, approved: true });
        bump(itemId);
        resolve(itemId, 'approved');
      },
      deny: (itemId: string) => resolve(itemId, 'denied'),
      revoke: (itemId: string, scope: 'approval' | 'grant_and_approval') => {
        const grant = grants.get(itemId);
        if (scope === 'grant_and_approval') grants.delete(itemId);
        else if (grant !== undefined) grant.approved = false;
        bump(itemId);
        if (requests.get(itemId)?.status === 'approved')
          resolve(itemId, 'revoked');
      },
    },
  };
};

export type StubVault = ReturnType<typeof stubVault>;
