import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Accessor } from 'solid-js';
import { createProjectSoupSource } from './queries/project-soup';

/** The command menu searches the same authorized Soup collection as Tasks. */
export function useProjectSearchQuery(
  search: Accessor<string>,
  enabled: Accessor<boolean>,
  userId: Accessor<string | undefined>
) {
  return createProjectSoupSource(
    getGraphqlSoupClient,
    () => ({ query: search().trim() || undefined }),
    () => Boolean(userId()) && enabled()
  );
}
