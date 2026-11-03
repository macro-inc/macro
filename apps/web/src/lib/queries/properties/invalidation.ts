import type { QueryClient } from '@tanstack/solid-query';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import { propertiesKeys } from './keys';

type PropertyReader = { entityId: string; refetch(): Promise<unknown> };
const readers = new WeakMap<QueryClient, Set<PropertyReader>>();

/** Register an active reader outside TanStack (for example, a GraphQL observer). */
export function registerEntityPropertyReader(
  client: QueryClient,
  reader: PropertyReader
) {
  let current = readers.get(client);
  if (!current) {
    current = new Set();
    readers.set(client, current);
  }
  current.add(reader);
  return () => {
    current.delete(reader);
  };
}

function refreshReaders(client: QueryClient, entityId?: string) {
  return [...(readers.get(client) ?? [])]
    .filter((reader) => !entityId || reader.entityId === entityId)
    .map((reader) => reader.refetch());
}

/** Refresh non-TanStack readers after a write outside their mutation cache. */
export function refetchEntityPropertyReaders(
  client: QueryClient,
  entityId: string
) {
  return Promise.all(refreshReaders(client, entityId));
}

/** An option edit can change labels or clear values on many source entities. */
export function invalidateAllPropertyReads(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: propertiesKeys._def }),
    ...refreshReaders(client),
  ]);
}

/** Keep individual editors and collections reading the same source values. */
export function invalidateEntityPropertyReads(
  client: QueryClient,
  entityType: EntityType,
  entityId: string,
  readers: 'all' | 'queries' = 'all'
) {
  return Promise.all([
    client.invalidateQueries({
      queryKey: propertiesKeys.entity({ entityType, entityId }).queryKey,
    }),
    client.invalidateQueries({
      queryKey: propertiesKeys.entityBatch._def,
      predicate: ({ queryKey }) => queryKey.includes(entityId),
    }),
    // GraphQL writes reconcile their own normalized records, including queued
    // offline mutations. A network read here can replace them with stale data.
    ...(readers === 'all' ? refreshReaders(client, entityId) : []),
  ]);
}
