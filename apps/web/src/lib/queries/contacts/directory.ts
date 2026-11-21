import type { IUser } from '@core/user/types';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  PEOPLE_MIN_POLICY_VERSION,
  PEOPLE_POLICY_VERSION,
  type PeopleSearch,
  type PeopleSearchResult,
} from '@graphql-cache/people/generated';
import { isStaleHydrationScopeError } from '@graphql-cache/protocol';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { ContactDirectoryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { fetchContactDirectoryPage } from '@service-storage/graphql-contacts';
import { hashKey } from '@tanstack/solid-query';
import { loadContactCheckpoint } from './backfill';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from './cache-scope';

export { ContactDirectoryScopeError } from './cache-scope';
export const CONTACT_WINDOW_SIZE = 50;

/** Offline without a usable local cache; hydration or context publication can
 * make a later local read available. */
export class ContactDirectoryUnavailableError extends Error {
  constructor() {
    super(
      'Local contact search is unavailable; wait for synchronization or retry'
    );
  }
}

export type ContactDirectoryCursor =
  | {
      source: 'people';
      userId: string;
      query: string;
      generation: string;
      after: string;
      policyKey: string;
    }
  | {
      source: 'server';
      userId: string;
      query: string;
      after: string;
      policyKey: string;
      /** Continues a window the server listed because the cache was late. */
      localLate?: boolean;
    };
export type ContactPeoplePolicy = Pick<
  PeopleSearch,
  'mode' | 'excluded' | 'senderDomain'
>;
export type RankedPerson = Extract<
  PeopleSearchResult,
  { kind: 'page' }
>['people'][number];
export type ContactDirectoryRequest = {
  query: string;
  limit?: number;
  cursor?: ContactDirectoryCursor;
  policy?: ContactPeoplePolicy;
  /** How long a first page waits for the local cache before the server is
   * read instead. Without it the read waits for the cache however long it
   * takes. */
  localBudgetMs?: number;
};
export type ContactDirectoryPage = {
  users: IUser[];
  people?: RankedPerson[];
  query: string;
  source: 'cache' | 'server';
  sync: 'cold' | 'partial' | 'snapshot' | 'unavailable';
  offline: boolean;
  /** The server answered because the cache did not within the request's
   * budget; the cache may still be usable for a later read. */
  localLate?: boolean;
  nextCursor: ContactDirectoryCursor | null;
};
export type ContactDirectoryHost = Pick<
  CacheHost,
  | 'people'
  | 'clientId'
  | 'disabled'
  | 'currentStorageGeneration'
  | 'readQuery'
  | 'readRecordsByKeys'
>;

/** Already-resolved scalar labels, not entries in the global display-name store. */
export function contactToUser(contact: ContactDirectoryFieldsFragment): IUser {
  return {
    id: contact.userId,
    email: contact.email,
    name: contact.name ?? (contact.email.split('@')[0] || contact.email),
  };
}

/** Interactive suggestions read the local indexed projection; incomplete
 * hydration is an explicit partial window. Only when this tab has no usable
 * local cache, and is online, do they read bounded server pages instead. */
export async function readContactDirectory(
  viewer: string,
  host: ContactDirectoryHost | undefined,
  request: ContactDirectoryRequest,
  signal: AbortSignal,
  online = typeof navigator === 'undefined' || navigator.onLine
): Promise<ContactDirectoryPage> {
  return Telemetry.span('contacts.read_window', async (span) => {
    signal.throwIfAborted();
    const limit = request.limit ?? CONTACT_WINDOW_SIZE;
    const policy: ContactPeoplePolicy = request.policy ?? {
      mode: 'property',
      excluded: [],
    };
    if (!viewer || !isBoundedWindow(request.query, limit, policy))
      throw new Error('Invalid contact window');
    const policyKey = hashKey([policy]);
    if (
      request.cursor &&
      (request.cursor.userId !== viewer ||
        request.cursor.query !== request.query ||
        request.cursor.policyKey !== policyKey)
    )
      throw new ContactDirectoryScopeError();
    span.setAttr('contacts.query_length', request.query.length);
    span.setAttr('contacts.limit', limit);
    span.setAttr('contacts.mode', policy.mode);
    // Pickers read further pages by themselves as their lists scroll.
    span.setAttr('contacts.continuation', !!request.cursor);
    const input = {
      viewer,
      request,
      policy,
      policyKey,
      limit,
      signal,
      online,
      span,
    };
    // A server continuation keeps paging the server; a cache change or a new
    // query restarts the window, which then tries the local cache first.
    const local =
      request.cursor?.source === 'server'
        ? undefined
        : await readLocalWithinBudget(host, input);
    const cacheLate = local === 'late' || local === 'failed';
    if (cacheLate) span.setAttr('contacts.local', local);
    if (!local && !online) throw new ContactDirectoryUnavailableError();
    // The read may have been superseded while it waited for the cache.
    signal.throwIfAborted();
    const page =
      local && !cacheLate
        ? local
        : await readLateAwareServerWindow(input, cacheLate);
    span.setAttr('contacts.source', page.source);
    span.setAttr('contacts.sync', page.sync);
    span.setAttr('contacts.result_count', page.users.length);
    return page;
  });
}

/** Whether a request fits the transport's input bounds. */
function isBoundedWindow(
  query: string,
  limit: number,
  policy: ContactPeoplePolicy
): boolean {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  return (
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= 500 &&
    bytes(query) <= 512 &&
    policy.excluded.length <= 500 &&
    policy.excluded.every((id) => bytes(id) <= 1024) &&
    (policy.senderDomain == null || bytes(policy.senderDomain) <= 255)
  );
}

/** How far contact hydration has progressed for this storage generation. */
function localSync(
  viewer: string,
  generation: string,
  resultCount: number
): ContactDirectoryPage['sync'] {
  const checkpoint = loadContactCheckpoint(viewer, generation);
  if (checkpoint.completedAt !== null) return 'snapshot';
  return checkpoint.pages || resultCount ? 'partial' : 'cold';
}

type WindowInput = {
  viewer: string;
  request: ContactDirectoryRequest;
  policy: ContactPeoplePolicy;
  policyKey: string;
  limit: number;
  signal: AbortSignal;
  online: boolean;
  span: Span;
};

/** The local window, unless a first page with a budget gets no answer from
 * the cache in time: a busy cache, or one changing owner, can hold a read for
 * many seconds or fail it, and the caller reads the server instead. The
 * abandoned read still finishes in the engine. */
async function readLocalWithinBudget(
  host: ContactDirectoryHost | undefined,
  input: WindowInput
): Promise<ContactDirectoryPage | undefined | 'late' | 'failed'> {
  // Offline there is no server to read instead, so the cache is waited for.
  const budget = input.request.localBudgetMs;
  if (budget === undefined || input.request.cursor || !input.online)
    return readLocalWindow(host, input);

  const settle = async () => {
    try {
      return { page: await readLocalWindow(host, input) };
    } catch (error) {
      return { error };
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), budget);
  });
  const first = await Promise.race([settle(), late]);
  clearTimeout(timer);
  if (first === 'late') return 'late';
  if (!('error' in first)) return first.page;
  // A continuation or scope mismatch, and a superseded read, are not the
  // cache failing to answer.
  if (first.error instanceof ContactDirectoryScopeError || input.signal.aborted)
    throw first.error;
  return 'failed';
}

/** Reads the local ranked projection. Returns undefined when this tab has no
 * usable cache for the viewer: no host, a retired or unsupported host, an
 * unbound viewer, a pending context, or an older people policy. */
async function readLocalWindow(
  host: ContactDirectoryHost | undefined,
  {
    viewer,
    request,
    policy,
    policyKey,
    limit,
    signal,
    online,
    span,
  }: WindowInput
): Promise<ContactDirectoryPage | undefined> {
  const people = host?.people;
  if (!host || host.disabled || !people) return undefined;

  const generation = await readContactCacheScope(host, viewer, signal);
  if (!generation) return undefined;

  // A continuation only resumes the storage generation that issued it.
  if (
    request.cursor?.source === 'people' &&
    request.cursor.generation !== generation
  )
    throw new ContactDirectoryScopeError();

  let result: Awaited<ReturnType<typeof people.search>>;
  try {
    result = await span.span('contacts.read_cached_window', () =>
      people.search({
        ...policy,
        scope: { identity: viewer, storageGeneration: generation },
        query: request.query,
        limit,
        nowMs: Date.now(),
        cursor: request.cursor?.after,
      })
    );
  } catch (error) {
    if (
      isStaleHydrationScopeError(error) ||
      (error instanceof Error &&
        error.message === 'contact search cursor changed')
    )
      throw new ContactDirectoryScopeError();
    throw error;
  }
  signal.throwIfAborted();
  await assertContactCacheScope(host, viewer, generation, signal);

  // Native hosts (desktop, iOS, Android) keep an older policy until their next
  // app release; its windows differ only in order, so they stay local.
  if (
    result.kind !== 'page' ||
    result.policyVersion < PEOPLE_MIN_POLICY_VERSION ||
    result.policyVersion > PEOPLE_POLICY_VERSION
  ) {
    // A local continuation cannot move to the server's ID-ordered pages.
    if (request.cursor) throw new ContactDirectoryScopeError();
    return undefined;
  }
  if (result.people.length > limit)
    throw new Error('Contact response exceeds its window');

  const sync = localSync(viewer, generation, result.people.length);
  return {
    users: result.people.map((person) => ({
      id: person.userId,
      name: person.name,
      email: person.email,
      lastInteraction:
        person.lastInteractionMs == null
          ? undefined
          : new Date(person.lastInteractionMs),
    })),
    people: result.people,
    query: request.query,
    source: 'cache',
    sync,
    offline: !online,
    nextCursor: result.nextCursor
      ? {
          source: 'people',
          userId: viewer,
          query: request.query,
          generation,
          after: result.nextCursor,
          policyKey,
        }
      : null,
  };
}

/** A server page that remembers, on itself and on its continuation, that it
 * stands in for a late cache: every page of such a window keeps its place. */
async function readLateAwareServerWindow(
  input: WindowInput,
  cacheLate: boolean
): Promise<ContactDirectoryPage> {
  const page = await readServerWindow(input);
  const cursor = input.request.cursor;
  const localLate =
    cacheLate || (cursor?.source === 'server' && cursor.localLate === true);
  if (!localLate) return page;
  return {
    ...page,
    localLate,
    nextCursor:
      page.nextCursor?.source === 'server'
        ? { ...page.nextCursor, localLate }
        : page.nextCursor,
  };
}

/** Without a usable local cache, reads one bounded server page. The server
 * filters by name/email subsequence in contact-ID order, without the local
 * recency ranking; explicit exclusions are applied here. A page may be empty
 * and still continue. */
async function readServerWindow({
  viewer,
  request,
  policy,
  policyKey,
  limit,
  signal,
  online,
  span,
}: WindowInput): Promise<ContactDirectoryPage> {
  // A server continuation cannot resume a local page.
  if (request.cursor && request.cursor.source !== 'server')
    throw new ContactDirectoryScopeError();

  const result = await span.span('contacts.read_server_window', () =>
    fetchContactDirectoryPage(
      {
        limit,
        after: request.cursor?.after ?? null,
        search: request.query || null,
      },
      signal
    )
  );
  if (result.user.id !== viewer) throw new ContactDirectoryScopeError();

  const page = result.user.contacts;
  if (page.nodes.length > limit)
    throw new Error('Contact response exceeds its window');

  const excluded = new Set(policy.excluded.map((id) => id.toLowerCase()));
  return {
    users: page.nodes
      .map(contactToUser)
      .filter((user) => !excluded.has(user.id.toLowerCase())),
    query: request.query,
    source: 'server',
    sync: 'unavailable',
    offline: !online,
    nextCursor: page.nextCursor
      ? {
          source: 'server',
          userId: viewer,
          query: request.query,
          after: page.nextCursor,
          policyKey,
        }
      : null,
  };
}
