import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import { listCanIncludeCrm, listCanIncludeCrmContacts } from './list-refresh';

/** The queue and network exchange each own their reads after a committed write. */
export function refreshCrmCreateLists(
  outcome?: {
    cacheRevalidates: boolean;
    listsReadAgain: boolean;
  },
  contactsOnly = false
) {
  if (outcome?.cacheRevalidates || outcome?.listsReadAgain) return;
  return refreshActiveGraphqlSoupQueries({
    where: contactsOnly ? listCanIncludeCrmContacts : listCanIncludeCrm,
    unmaintainedOnly: getGraphqlCacheHost() !== undefined,
  });
}
