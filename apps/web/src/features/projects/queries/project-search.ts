import type { Accessor } from 'solid-js';
import { createProjectSoupSource } from './project-soup';

/** The command menu searches the same authorized Soup collection as Tasks. */
export function useProjectSearchQuery(
  search: Accessor<string>,
  enabled: Accessor<boolean>,
  userId: Accessor<string | undefined>
) {
  return createProjectSoupSource(
    () => ({ query: search().trim() || undefined }),
    () => Boolean(userId()) && enabled()
  );
}
