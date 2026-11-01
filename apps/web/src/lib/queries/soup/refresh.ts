import { queryClient } from '@queries/client';
import { partialMatchKey, type Query } from '@tanstack/solid-query';
import { soupKeys } from './keys';
import { getSoupNormalizer, soupNormKey } from './normalized-cache/normalizer';

/**
 * Revalidate the REST lists that already hold these entities after a committed
 * server change. Lists that do not hold them are left alone.
 */
export async function refreshSoupEntities(
  entityIds: string[],
  options: { throwOnError?: boolean } = {}
): Promise<void> {
  // Normy JSON-roundtrips complete keys, turning undefined array slots (a flat
  // AST list's groupBy and transport) into null. Exact matching uses the same
  // hash; partial matching misses them.
  const hashes = new Set(
    entityIds.flatMap((id) =>
      getSoupNormalizer()
        .getDependentQueriesByIds([soupNormKey(id)])
        .map(
          (queryKey) => queryClient.defaultQueryOptions({ queryKey }).queryHash
        )
    )
  );
  if (hashes.size === 0) return;
  const listPrefixes = [
    soupKeys.items._def,
    soupKeys.astItems._def,
    soupKeys.groupedGroup._def,
  ];
  const predicate = (query: Query) =>
    listPrefixes.some((prefix) => partialMatchKey(query.queryKey, prefix)) &&
    hashes.has(query.queryHash);

  // Cancel an in-flight refetch so its older snapshot cannot land after this one.
  await queryClient.cancelQueries({ predicate, type: 'active' });
  await queryClient.invalidateQueries({ predicate }, options);
}
