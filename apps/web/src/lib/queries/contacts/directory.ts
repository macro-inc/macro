import type { IUser } from '@core/user/types';
import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import type { CacheHost } from '@graphql-cache/host/types';
import type {
  PeopleSearch,
  PeopleSearchResult,
} from '@graphql-cache/people/generated';
import {
  isStaleHydrationScopeError,
  type SearchCursor,
} from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import {
  type ContactDirectoryFieldsFragment,
  ContactDirectoryFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import { fetchContactDirectoryPage } from '@service-storage/graphql-contacts';
import { hashKey } from '@tanstack/solid-query';
import { CombinedError } from '@urql/core';
import { loadContactCheckpoint } from './backfill';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from './cache-scope';

export { ContactDirectoryScopeError } from './cache-scope';

const CONTACT_SELECTION = selectRecords(ContactDirectoryFieldsFragmentDoc);
export const CONTACT_WINDOW_SIZE = 50;

/** A later local hydration/context hint may make this read available. */
export class ContactDirectoryOfflineError extends Error {
  constructor() {
    super('Contacts are unavailable offline');
  }
}

/** Cursors retain their source, account and query; cache cursors also require
 * the same durable generation. A source switch must start at the beginning. */
export type ContactDirectoryCursor = { userId: string; query: string } & (
  | { source: 'cache'; generation: string; after: SearchCursor }
  | { source: 'people'; generation: string; after: string; policyKey: string }
  | { source: 'server'; after: string; policyKey?: string }
);
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
  /** Explicit user refresh bypasses an otherwise usable cached snapshot. */
  fresh?: boolean;
  /** Menu policy is evaluated before the native result window, not afterward. */
  policy?: ContactPeoplePolicy;
};
export type ContactDirectoryPage = {
  users: IUser[];
  /** Present only for a context-ranked cache window; server pages are ID-ordered. */
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
  | 'search'
  | 'readRecordsByKeys'
>;

/** Does not touch the global display-name store. Cache IDs are never navigation IDs. */
export function contactToUser(contact: ContactDirectoryFieldsFragment): IUser {
  return {
    id: contact.userId,
    email: contact.email,
    name: contact.name ?? (contact.email.split('@')[0] || contact.email),
  };
}

async function cachedPage(
  viewer: string,
  host: ContactDirectoryHost,
  request: ContactDirectoryRequest,
  limit: number,
  signal: AbortSignal
): Promise<{ page: ContactDirectoryPage; generation: string } | undefined> {
  const generation = await readContactCacheScope(host, viewer, signal);
  if (!generation) return undefined;
  if (
    request.cursor &&
    request.cursor.source !== 'server' &&
    request.cursor.generation !== generation
  )
    throw new ContactDirectoryScopeError();
  if (request.policy) {
    if (!host.people) return;
    const result = await host.people.search({
      ...request.policy,
      scope: { identity: viewer, storageGeneration: generation },
      query: request.query,
      limit,
      nowMs: Date.now(),
      cursor:
        request.cursor?.source === 'people' ? request.cursor.after : undefined,
    });
    signal.throwIfAborted();
    if (result.kind !== 'page' || result.policyVersion < 3) return;
    if (result.people.length > limit)
      throw new Error('Contact response exceeds its window');
    await assertContactCacheScope(host, viewer, generation, signal);
    const checkpoint = loadContactCheckpoint(viewer, generation);
    return {
      generation,
      page: {
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
        offline: false,
        sync:
          checkpoint.completedAt !== null
            ? 'snapshot'
            : checkpoint.pages || result.people.length
              ? 'partial'
              : 'cold',
        nextCursor: result.nextCursor
          ? {
              source: 'people',
              userId: viewer,
              query: request.query,
              generation,
              after: result.nextCursor,
              policyKey: hashKey([request.policy]),
            }
          : null,
      },
    };
  }
  const hits = await host.search({
    profile: 'quick-access-v1',
    buckets: ['person'],
    query: request.query,
    limit,
    cursor:
      request.cursor?.source === 'cache' ? request.cursor.after : undefined,
  });
  signal.throwIfAborted();
  if ((hits.projectionVersion ?? 0) < 5) return undefined;
  const selected = await readRecordsByKeys(
    host,
    CONTACT_SELECTION,
    hits.documents.map((hit) => hit.recordKey)
  );
  signal.throwIfAborted();
  await assertContactCacheScope(host, viewer, generation, signal);
  const checkpoint = loadContactCheckpoint(viewer, generation);
  const users = selected.records.map(({ record }) => contactToUser(record));
  let sync: ContactDirectoryPage['sync'] = 'cold';
  if (checkpoint.completedAt !== null) sync = 'snapshot';
  else if (checkpoint.pages > 0 || users.length > 0) sync = 'partial';
  return {
    generation,
    page: {
      users,
      query: request.query,
      source: 'cache',
      offline: false,
      sync,
      nextCursor: hits.nextCursor
        ? {
            source: 'cache',
            userId: viewer,
            query: request.query,
            generation,
            after: hits.nextCursor,
          }
        : null,
    },
  };
}

/** One result window, never a directory-sized array. Cache text search is ranked
 * top-K; server fallback is source-ID pagination and may be empty with a cursor.
 * Neither cached snapshots nor failed/incomplete scans prove current absence. */
export async function readContactDirectory(
  viewer: string,
  host: ContactDirectoryHost | undefined,
  request: ContactDirectoryRequest,
  signal: AbortSignal,
  fetchPage = fetchContactDirectoryPage,
  online = typeof navigator === 'undefined' || navigator.onLine
): Promise<ContactDirectoryPage> {
  return Telemetry.span('contacts.read_window', async (span) => {
    signal.throwIfAborted();
    const limit = request.limit ?? CONTACT_WINDOW_SIZE;
    if (
      !viewer ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      new TextEncoder().encode(request.query).length > 512 ||
      (request.policy &&
        (request.policy.excluded.length > 500 ||
          request.policy.excluded.some(
            (id) => new TextEncoder().encode(id).length > 1024
          ) ||
          (request.policy.senderDomain != null &&
            new TextEncoder().encode(request.policy.senderDomain).length >
              255)))
    )
      throw new Error('Invalid contact window');
    if (
      request.cursor &&
      (request.cursor.userId !== viewer ||
        request.cursor.query !== request.query ||
        (request.cursor.source !== 'cache' &&
          request.cursor.policyKey !==
            (request.policy ? hashKey([request.policy]) : undefined)) ||
        (request.cursor.source === 'cache' && !!request.policy) ||
        (request.cursor.source === 'people' && !request.policy))
    )
      throw new ContactDirectoryScopeError();
    span.setAttr('contacts.query_length', request.query.length);
    span.setAttr('contacts.limit', limit);
    let snapshot: Awaited<ReturnType<typeof cachedPage>>;
    if (
      host &&
      !host.disabled &&
      !request.fresh &&
      request.cursor?.source !== 'server'
    ) {
      try {
        snapshot = await span.span('contacts.read_cached_window', () =>
          cachedPage(viewer, host, request, limit, signal)
        );
      } catch (error) {
        if (
          isStaleHydrationScopeError(error) ||
          (error instanceof Error &&
            error.message === 'contact search cursor changed')
        )
          throw new ContactDirectoryScopeError();
        if (
          signal.aborted ||
          error instanceof ContactDirectoryScopeError ||
          request.cursor
        )
          throw error;
        span.setAttr('contacts.cache_unavailable', true);
      }
    }
    signal.throwIfAborted();
    const local = snapshot?.page;
    if (request.cursor && request.cursor.source !== 'server' && !local)
      throw new ContactDirectoryScopeError();
    let result: ContactDirectoryPage;
    if (
      local &&
      (local.sync === 'snapshot' ||
        (request.cursor && request.cursor.source !== 'server') ||
        !online)
    ) {
      result = { ...local, offline: !online };
    } else {
      try {
        if (!online) throw new ContactDirectoryOfflineError();
        const page = await fetchPage(
          {
            limit,
            after:
              request.cursor?.source === 'server' ? request.cursor.after : null,
            search: request.query,
          },
          signal
        );
        signal.throwIfAborted();
        if (page.user.id !== viewer) throw new ContactDirectoryScopeError();
        if (page.user.contacts.nodes.length > limit)
          throw new Error('Contact response exceeds its window');
        result = {
          users: page.user.contacts.nodes
            .map(contactToUser)
            .filter((user) => !request.policy?.excluded.includes(user.id)),
          query: request.query,
          source: 'server',
          sync: local?.sync ?? 'unavailable',
          offline: false,
          nextCursor:
            page.user.contacts.nextCursor !== null
              ? {
                  source: 'server',
                  userId: viewer,
                  query: request.query,
                  after: page.user.contacts.nextCursor,
                  ...(request.policy
                    ? { policyKey: hashKey([request.policy]) }
                    : {}),
                }
              : null,
        };
      } catch (error) {
        signal.throwIfAborted();
        // Only a transport failure permits stale cached data. Never hide HTTP or
        // GraphQL authorization errors as an offline success.
        if (
          !local ||
          !(error instanceof CombinedError) ||
          !error.networkError ||
          error.response
        )
          throw error;
        // Network work introduced another async gap since the local read.
        // Re-prove its original scope before exposing an offline fallback.
        if (!host || !snapshot) throw new ContactDirectoryScopeError();
        await assertContactCacheScope(
          host,
          viewer,
          snapshot.generation,
          signal
        );
        result = { ...local, offline: true };
      }
    }
    span.setAttr('contacts.source', result.source);
    span.setAttr('contacts.sync', result.sync);
    span.setAttr('contacts.result_count', result.users.length);
    return result;
  });
}
