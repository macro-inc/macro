import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { queryClient } from '@queries/client';
import { partialMatchKey, type Query } from '@tanstack/solid-query';
import { refreshActiveGraphqlSoupQueries } from './graphql/active-queries';
import { soupKeys } from './keys';

/** A deadline edit can admit previously excluded rows and change unloaded counts. */
export async function refreshTaskDeadlineQueries(): Promise<void> {
  const prefixes = [
    soupKeys.astItems._def,
    soupKeys.groupedGroup._def,
    soupKeys.search._def,
  ];
  const predicate = (query: Query) => {
    if (!prefixes.some((prefix) => partialMatchKey(query.queryKey, prefix)))
      return false;
    const key = JSON.stringify(query.queryKey);
    return (
      key.includes(SYSTEM_PROPERTY_IDS.DUE_DATE) ||
      key.includes('due_date_') ||
      key.includes('"deadline"')
    );
  };
  await Promise.all([
    queryClient.invalidateQueries({ predicate }),
    refreshActiveGraphqlSoupQueries({
      where: (body) => {
        const json = JSON.stringify(body);
        return (
          !!json &&
          (json.includes(SYSTEM_PROPERTY_IDS.DUE_DATE) ||
            json.includes('"dst":"task"'))
        );
      },
    }),
  ]);
}
