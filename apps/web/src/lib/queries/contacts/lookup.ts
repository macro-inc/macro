import { emailToMacroId, tryMacroId } from '@core/user/macroId';
import type { IUser } from '@core/user/types';
import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import type { CacheHost } from '@graphql-cache/host/types';
import { captureContactWriteScope } from '@graphql-cache/people/sync';
import {
  type HydrationScope,
  isStaleHydrationScopeError,
} from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import {
  ContactDirectoryByUserIdsDocument,
  ContactDirectoryFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import { fetchContactDirectoryByIds } from '@service-storage/graphql-contacts';
import { CombinedError } from '@urql/core';
import { print } from 'graphql';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from './cache-scope';
import { contactRecordKey } from './contact-key';
import { contactToUser } from './directory';

export const MAX_CONTACT_LOOKUP = 500;
export type ContactLookup = {
  kind: 'ids' | 'emails';
  values: readonly string[];
};
export type ContactLookupHost = Pick<
  CacheHost,
  | 'clientId'
  | 'disabled'
  | 'currentStorageGeneration'
  | 'readQuery'
  | 'readRecordsByKeys'
> &
  Partial<Pick<CacheHost, 'search' | 'hydrateQuery' | 'people'>>;
export type ContactResolution = {
  users: IUser[];
  /** Canonical requested IDs not resolved. Offline absence is not non-membership. */
  unresolved: string[];
  source: 'server' | 'cache' | 'empty';
  offline: boolean;
};
const SELECTION = selectRecords(ContactDirectoryFieldsFragmentDoc);
const LOOKUP_DOCUMENT = print(ContactDirectoryByUserIdsDocument);

/** Bound raw input before deduplication, preserving first-requested order. */
export function contactLookupIds(lookup: ContactLookup): string[] {
  if (lookup.values.length > MAX_CONTACT_LOOKUP)
    throw new Error('Contact lookup exceeds its batch bound');
  const ids = lookup.values.map((value) => {
    if (value.length > 1024) throw new Error('Invalid contact lookup');
    const canonical = value.trim().toLowerCase();
    const id =
      lookup.kind === 'ids' ? tryMacroId(canonical) : emailToMacroId(canonical);
    if (!id || id.includes('\0') || id.length > 1024)
      throw new Error('Invalid contact lookup');
    return id;
  });
  return [...new Set(ids)];
}

function resolution(
  ids: string[],
  users: IUser[],
  source: ContactResolution['source'],
  offline: boolean
): ContactResolution {
  const byId = new Map(users.map((user) => [user.id, user]));
  return {
    users: ids.flatMap((id) => {
      const user = byId.get(id);
      return user ? [user] : [];
    }),
    unresolved: ids.filter((id) => !byId.has(id)),
    source,
    offline,
  };
}

/** Online lookup is authoritative for this requested batch. Offline lookup reads
 * only its viewer-scoped normalized keys, never searches or scans the directory.
 * Missing selected people remain the caller's selection, not a deletion signal. */
export async function resolveContactDirectory(
  viewer: string,
  host: ContactLookupHost | undefined,
  lookup: ContactLookup,
  signal: AbortSignal,
  fetchIds = fetchContactDirectoryByIds,
  online = typeof navigator === 'undefined' || navigator.onLine
): Promise<ContactResolution> {
  return Telemetry.span('contacts.resolve_selection', async (span) => {
    signal.throwIfAborted();
    const ids = contactLookupIds(lookup);
    span.setAttr('contacts.lookup_count', ids.length);
    if (ids.length === 0) return resolution(ids, [], 'empty', !online);
    if (!viewer) throw new Error('Contact lookup requires authentication');
    const keysById = new Map(
      ids.map((id) => [id, contactRecordKey(viewer, id)])
    );
    let cached: { users: IUser[]; generation: string } | undefined;
    if (host && !host.disabled) {
      try {
        const generation = await readContactCacheScope(host, viewer, signal);
        if (generation) {
          const selected = await readRecordsByKeys(host, SELECTION, [
            ...keysById.values(),
          ]);
          await assertContactCacheScope(host, viewer, generation, signal);
          cached = {
            generation,
            users: selected.records.flatMap(({ recordKey, record }) =>
              keysById.get(record.userId) === recordKey &&
              recordKey === `GraphqlContact:${record.id}`
                ? [contactToUser(record)]
                : []
            ),
          };
        }
      } catch (error) {
        if (signal.aborted || error instanceof ContactDirectoryScopeError)
          throw error;
        span.setAttr('contacts.cache_unavailable', true);
      }
    }
    signal.throwIfAborted();
    if (!online) {
      if (!cached) throw new Error('Selected contacts are unavailable offline');
      span.setAttr('contacts.source', 'cache');
      span.setAttr('contacts.offline', true);
      span.setAttr('contacts.resolved_count', cached.users.length);
      return resolution(ids, cached.users, 'cache', true);
    }
    let guarded: HydrationScope | undefined;
    if (cached && host?.people) {
      try {
        guarded = await captureContactWriteScope(
          host,
          { identity: viewer, storageGeneration: cached.generation },
          signal
        );
      } catch (error) {
        signal.throwIfAborted();
        if (isStaleHydrationScopeError(error))
          throw new ContactDirectoryScopeError();
      }
    }
    try {
      const data = await fetchIds(ids, signal);
      signal.throwIfAborted();
      if (data.user.id !== viewer) throw new ContactDirectoryScopeError();
      if (data.user.contactsByUserIds.length > ids.length)
        throw new Error('Contact lookup response exceeds its batch bound');
      const contacts = data.user.contactsByUserIds.flatMap((record) => {
        const expected = keysById.get(record.userId);
        if (!expected) return [];
        if (expected !== `GraphqlContact:${record.id}`)
          throw new ContactDirectoryScopeError();
        return [record];
      });
      const users = contacts.map(contactToUser);
      span.setAttr('contacts.resolved_count', users.length);
      span.setAttr('contacts.source', 'server');
      if (guarded && host?.search && host.hydrateQuery) {
        try {
          const capability = await host.search({
            profile: 'quick-access-v1',
            buckets: ['person'],
            limit: 1,
          });
          signal.throwIfAborted();
          if ((capability.projectionVersion ?? 0) >= 5) {
            await host.hydrateQuery({
              query: LOOKUP_DOCUMENT,
              operationName: 'ContactDirectoryByUserIds',
              variables: { userIds: ids },
              data: { user: { id: viewer, contactsByUserIds: contacts } },
              identity: viewer,
              hydrationScope: guarded,
            });
          }
        } catch (error) {
          signal.throwIfAborted();
          if (isStaleHydrationScopeError(error))
            throw new ContactDirectoryScopeError();
          // A successful server read survives an unavailable optional cache.
          span.setAttr('contacts.cache_write_failed', true);
        }
      }
      signal.throwIfAborted();
      // An authoritative omission never resurrects a stale cached contact.
      return resolution(ids, users, 'server', false);
    } catch (error) {
      signal.throwIfAborted();
      if (
        !host ||
        !cached ||
        !(error instanceof CombinedError) ||
        !error.networkError ||
        error.response
      )
        throw error;
      await assertContactCacheScope(host, viewer, cached.generation, signal);
      span.setAttr('contacts.offline', true);
      span.setAttr('contacts.source', 'cache');
      span.setAttr('contacts.resolved_count', cached.users.length);
      return resolution(ids, cached.users, 'cache', true);
    }
  });
}
