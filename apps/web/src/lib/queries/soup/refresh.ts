import { queryClient } from '@queries/client';
import { partialMatchKey, type Query } from '@tanstack/solid-query';
import { soupKeys } from './keys';
import { getSoupNormalizer, soupNormKey } from './normalized-cache/normalizer';

/**
 * Revalidate REST lists after a committed server change. Initial reads have no
 * normalized dependencies yet, so they must also be cancelled and restarted.
 * Unknown entities can enter any list; known entities target dependent lists.
 */
export async function refreshSoupEntities(
  entityIds?: string[],
  options: { throwOnError?: boolean } = {}
): Promise<void> {
  const dependencies = entityIds?.map((id) =>
    getSoupNormalizer().getDependentQueriesByIds([soupNormKey(id)])
  );
  const all =
    !dependencies?.length || dependencies.some((keys) => !keys.length);
  const keys = dependencies?.flat() ?? [];
  const listPrefixes = [
    soupKeys.items._def,
    soupKeys.astItems._def,
    soupKeys.groupedGroup._def,
  ];
  const predicate = (query: Query) =>
    listPrefixes.some((prefix) => partialMatchKey(query.queryKey, prefix)) &&
    (all ||
      query.state.data === undefined ||
      keys.some((key) => partialMatchKey(query.queryKey, key)));

  // Explicit cancellation also supersedes initial requests with no data;
  // invalidateQueries alone would share their older in-flight result.
  await queryClient.cancelQueries({ predicate, type: 'active' });
  await queryClient.invalidateQueries({ predicate }, options);
}
