/**
 * The agent's own Gmail account through the Gmail API, behind a small port so
 * everything else here runs without a network. The OAuth client needs the
 * gmail.readonly and gmail.send scopes and nothing else. Its refresh token
 * lasts only 7 days while the OAuth app is in Google's "testing" status, so
 * the app is published, or internal to a Workspace. History is polled rather
 * than pushed: Pub/Sub needs a topic, a push endpoint and a renewal every 7
 * days to save at most a minute, and IMAP IDLE needs an app password, which
 * has the whole mailbox and no scopes.
 */
import type { Clock } from '@macro-inc/muppet/utilities/time';
import { z } from 'zod';
import { gmail } from './config.ts';
import { RawMail } from './message.ts';

export type Since =
  | {
      readonly kind: 'ok';
      readonly ids: readonly string[];
      readonly position: string;
    }
  /** The saved position is too old for Gmail (about a week): resync from a search. */
  | { readonly kind: 'expired' };

export type Mailbox = {
  /** The mailbox's current position. */
  readonly position: () => Promise<string>;
  /** Message ids added since a position, and the new position. */
  readonly since: (position: string) => Promise<Since>;
  /** Ids a search finds, newest first. */
  readonly search: (query: string) => Promise<readonly string[]>;
  /** One message, or undefined if it's gone. */
  readonly get: (id: string) => Promise<RawMail | undefined>;
  /** Sends an RFC 5322 message in a thread. */
  readonly send: (
    raw: string,
    threadId: string
  ) => Promise<{ readonly id: string }>;
};

/** Everything but sending: what the rest of the agent is given. */
export type ReadOnlyMailbox = Omit<Mailbox, 'send'>;

export type MailboxCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
};

const Token = z.object({ access_token: z.string(), expires_in: z.number() });
const Profile = z.object({ historyId: z.union([z.string(), z.number()]) });
const History = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z
          .array(z.object({ message: z.object({ id: z.string() }) }))
          .optional(),
      })
    )
    .optional(),
  historyId: z.union([z.string(), z.number()]).optional(),
  nextPageToken: z.string().optional(),
});
const Found = z.object({
  messages: z.array(z.object({ id: z.string() })).optional(),
});
const Sent = z.object({ id: z.string() });

const notFound = 404;
/** A token is renewed this long before it runs out. */
const earlySeconds = 60;
const pageSize = 500;
const searchSize = 200;

const base64url = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const gmailApi = ({
  credentials,
  fetch: request,
  clock,
}: {
  /** Read when a token is first needed, so nothing is asked of the credentials until the mailbox is used. */
  readonly credentials: () => Promise<MailboxCredentials>;
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly clock: Pick<Clock, 'now'>;
}): Mailbox => {
  let token:
    | { readonly value: string; readonly until: Temporal.Instant }
    | undefined;
  const authorize = async (): Promise<string> => {
    if (
      token !== undefined &&
      Temporal.Instant.compare(clock.now(), token.until) < 0
    )
      return token.value;
    const { clientId, clientSecret, refreshToken } = await credentials();
    const response = await request(gmail.token, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(gmail.timeoutMs),
    });
    // Never the response: it can echo credentials.
    if (!response.ok) throw new Error(`gmail token: ${response.status}`);
    const granted = Token.parse(await response.json());
    token = {
      value: granted.access_token,
      until: clock.now().add({ seconds: granted.expires_in - earlySeconds }),
    };
    return token.value;
  };
  const call = async (path: string, init: RequestInit = {}) =>
    request(`${gmail.api}/${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${await authorize()}`,
      },
      signal: AbortSignal.timeout(gmail.timeoutMs),
    });
  /** The path without its query, for an error: a query can hold a search. */
  const named = (path: string) => path.split('?')[0];
  return {
    position: async () => {
      const response = await call('profile');
      if (!response.ok) throw new Error(`gmail profile: ${response.status}`);
      return String(Profile.parse(await response.json()).historyId);
    },
    since: async (position) => {
      const ids = new Set<string>();
      let next = position;
      let page: string | undefined;
      do {
        const path = `history?startHistoryId=${encodeURIComponent(position)}&historyTypes=messageAdded&maxResults=${pageSize}${page === undefined ? '' : `&pageToken=${encodeURIComponent(page)}`}`;
        const response = await call(path);
        if (response.status === notFound) return { kind: 'expired' };
        if (!response.ok)
          throw new Error(`gmail ${named(path)}: ${response.status}`);
        const listed = History.parse(await response.json());
        for (const { messagesAdded } of listed.history ?? [])
          for (const { message } of messagesAdded ?? []) ids.add(message.id);
        if (listed.historyId !== undefined) next = String(listed.historyId);
        page = listed.nextPageToken;
      } while (page !== undefined && page !== '');
      return { kind: 'ok', ids: [...ids], position: next };
    },
    search: async (query) => {
      const response = await call(
        `messages?maxResults=${searchSize}&includeSpamTrash=false&q=${encodeURIComponent(query)}`
      );
      if (!response.ok) throw new Error(`gmail messages: ${response.status}`);
      return (Found.parse(await response.json()).messages ?? []).map(
        ({ id }) => id
      );
    },
    get: async (id) => {
      const response = await call(
        `messages/${encodeURIComponent(id)}?format=full`
      );
      if (response.status === notFound) return undefined;
      if (!response.ok) throw new Error(`gmail get: ${response.status}`);
      return RawMail.parse(await response.json());
    },
    send: async (raw, threadId) => {
      const response = await call('messages/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: base64url(raw), threadId }),
      });
      if (!response.ok) throw new Error(`gmail send: ${response.status}`);
      return { id: Sent.parse(await response.json()).id };
    },
  };
};

/** A mailbox without its `send`, so nothing given it can send. */
export const readOnly = ({
  position,
  since,
  search,
  get,
}: Mailbox): ReadOnlyMailbox => ({ position, since, search, get });
