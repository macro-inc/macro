import type { IUser } from '@core/user/types';
import {
  type CacheAuthority,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
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
};
export type ContactDirectoryPage = {
  users: IUser[];
  people?: RankedPerson[];
  query: string;
  source: 'cache' | 'server';
  sync: 'cold' | 'partial' | 'snapshot' | 'unavailable';
  offline: boolean;
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
  | 'authority'
> &
  Partial<Pick<CacheHost, 'onCacheGenerationChanged'>>;

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
        : await readLocalWindow(host, input);
    if (!local && !online) throw new ContactDirectoryUnavailableError();
    const page = local ?? (await readServerWindow(input));
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

/** Direct contact reads do not pass through the exchange's stale-read recovery.
 * Retry the complete window once so first binding cannot strand a picker, but
 * never reuse its rejected identity, generation, or people result. */
async function readLocalWindow(
  host: ContactDirectoryHost | undefined,
  input: WindowInput
): Promise<ContactDirectoryPage | undefined> {
  const authority = host?.authority;
  if (!host || !authority) return readLocalWindowOnce(host, input);

  let account = authority.snapshot()?.account ?? null;
  let invalidated = account !== null && account !== input.viewer;
  const observe = (next: CacheAuthority) => {
    const nextAccount = next.account ?? null;
    if (
      nextAccount !== account &&
      (account !== null || nextAccount !== input.viewer)
    )
      invalidated = true;
    account = nextAccount;
  };
  const stopAuthority = authority.onChanged(observe);
  const stopGeneration = host.onCacheGenerationChanged?.(() => {
    invalidated = true;
  });
  const assertRecovery = (error: StaleCacheAuthorityError) => {
    input.signal.throwIfAborted();
    if (invalidated || host.disabled || host.authority !== authority)
      throw error;
  };
  try {
    return await readLocalWindowOnce(host, input);
  } catch (error) {
    if (!(error instanceof StaleCacheAuthorityError)) throw error;
    assertRecovery(error);
    return await input.span.span(
      'contacts.retry_local_window',
      async (span) => {
        span.setAttr('cache.retry.reason', 'authority-change');
        span.setAttr('cache.retry.count', 1);
        observe(await authority.current());
        assertRecovery(error);
        if (authority.snapshot()?.account !== input.viewer) throw error;
        const page = await readLocalWindowOnce(host, { ...input, span });
        assertRecovery(error);
        if (authority.snapshot()?.account !== input.viewer) throw error;
        return page;
      }
    );
  } finally {
    stopGeneration?.();
    stopAuthority();
  }
}

/** Reads the local ranked projection. Returns undefined when this tab has no
 * usable cache for the viewer: no host, a retired or unsupported host, an
 * unbound viewer, a pending context, or an older people policy. */
async function readLocalWindowOnce(
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
