import type { IUser } from '@core/user/types';
import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import type { CacheHost } from '@graphql-cache/host/types';
import type { SearchCursor } from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import {
  type ContactDirectoryFieldsFragment,
  ContactDirectoryFieldsFragmentDoc,
  ContactDirectoryIdentityDocument,
} from '@service-storage/graphql/generated/graphql';
import { fetchContactDirectoryPage } from '@service-storage/graphql-contacts';
import { CombinedError } from '@urql/core';
import { print } from 'graphql';
import { loadContactCheckpoint } from './backfill';

const IDENTITY_DOCUMENT = print(ContactDirectoryIdentityDocument);
const CONTACT_SELECTION = selectRecords(ContactDirectoryFieldsFragmentDoc);
export const CONTACT_WINDOW_SIZE = 50;

/** Cursors retain their source, account and query; cache cursors also require
 * the same durable generation. A source switch must start at the beginning. */
export type ContactDirectoryCursor = { userId: string; query: string } & (
  | { source: 'cache'; generation: string; after: SearchCursor }
  | { source: 'server'; after: string }
);
export type ContactDirectoryRequest = {
  query: string;
  limit?: number;
  cursor?: ContactDirectoryCursor;
  /** Explicit user refresh bypasses an otherwise usable cached snapshot. */
  fresh?: boolean;
};
export type ContactDirectoryPage = {
  users: IUser[];
  query: string;
  source: 'cache' | 'server';
  sync: 'cold' | 'partial' | 'snapshot' | 'unavailable';
  offline: boolean;
  nextCursor: ContactDirectoryCursor | null;
};
export type ContactDirectoryHost = Pick<
  CacheHost,
  | 'clientId'
  | 'disabled'
  | 'currentStorageGeneration'
  | 'readQuery'
  | 'search'
  | 'readRecordsByKeys'
>;

export class ContactDirectoryScopeError extends Error {
  constructor() {
    super('Contact directory scope changed; restart this page');
  }
}

function hasViewer(data: unknown, viewer: string): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'user' in data &&
    typeof data.user === 'object' &&
    data.user !== null &&
    'id' in data.user &&
    data.user.id === viewer
  );
}
async function currentViewer(
  host: ContactDirectoryHost,
  viewer: string
): Promise<boolean> {
  const result = await host.readQuery({
    query: IDENTITY_DOCUMENT,
    operationName: 'ContactDirectoryIdentity',
  });
  return result.kind === 'hit' && hasViewer(result.data, viewer);
}

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
  const generation = await host.currentStorageGeneration();
  signal.throwIfAborted();
  if (!(await currentViewer(host, viewer))) return undefined;
  if (
    request.cursor?.source === 'cache' &&
    request.cursor.generation !== generation
  )
    throw new ContactDirectoryScopeError();
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
  if (
    !(await currentViewer(host, viewer)) ||
    generation !== (await host.currentStorageGeneration())
  )
    throw new ContactDirectoryScopeError();
  signal.throwIfAborted();
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
      new TextEncoder().encode(request.query).length > 512
    )
      throw new Error('Invalid contact window');
    if (
      request.cursor &&
      (request.cursor.userId !== viewer ||
        request.cursor.query !== request.query)
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
          signal.aborted ||
          error instanceof ContactDirectoryScopeError ||
          request.cursor?.source === 'cache'
        )
          throw error;
        span.setAttr('contacts.cache_unavailable', true);
      }
    }
    signal.throwIfAborted();
    const local = snapshot?.page;
    if (request.cursor?.source === 'cache' && !local)
      throw new ContactDirectoryScopeError();
    let result: ContactDirectoryPage;
    if (
      local &&
      (local.sync === 'snapshot' ||
        request.cursor?.source === 'cache' ||
        !online)
    ) {
      result = { ...local, offline: !online };
    } else {
      try {
        if (!online) throw new Error('Contacts are unavailable offline');
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
          users: page.user.contacts.nodes.map(contactToUser),
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
        if (
          !host ||
          !(await currentViewer(host, viewer)) ||
          snapshot?.generation !== (await host.currentStorageGeneration())
        )
          throw new ContactDirectoryScopeError();
        signal.throwIfAborted();
        result = { ...local, offline: true };
      }
    }
    span.setAttr('contacts.source', result.source);
    span.setAttr('contacts.sync', result.sync);
    span.setAttr('contacts.result_count', result.users.length);
    return result;
  });
}
