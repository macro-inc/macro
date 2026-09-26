import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableProjects } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import type { TimestampedItem } from '@core/util/freshSort';
import type { Accessor } from 'solid-js';
import { useProjectSearchQuery } from '../projects/queries/project-search';

export type ProjectCommandItem = {
  id: string;
  kind: 'initiative';
  bucket: 'initiative';
  searchText: string;
  sortTimestamp: number;
  timestamps: TimestampedItem;
  name: string;
};

export type CreateProjectCommandItem = {
  id: 'new-project';
  kind: 'new-project';
  bucket: 'command';
  searchText: string;
  sortTimestamp: number;
  timestamps: TimestampedItem;
};

export const newProjectCommand: CreateProjectCommandItem = {
  id: 'new-project',
  kind: 'new-project',
  bucket: 'command',
  searchText: 'Create new project',
  sortTimestamp: 0,
  timestamps: { viewedAt: undefined, updatedAt: undefined },
};

/** Authorized server search for native projects, independent of the folder index. */
export function useProjectCommandItems(
  search: Accessor<string>,
  searchActive: Accessor<boolean>
) {
  const userId = useUserId();
  const projectsFlag = useFeatureFlag(enableProjects);
  const enabled = () => projectsFlag().enabled && searchActive();
  const query = useProjectSearchQuery(search, enabled, userId);
  return {
    enabled,
    items: (): ProjectCommandItem[] =>
      enabled() && !query.isPending && !query.isError
        ? (query.data?.pages
            .flatMap((page) => page.initiatives)
            .map((project) => ({
              id: project.id,
              kind: 'initiative',
              bucket: 'initiative',
              name: project.name,
              searchText: project.name,
              sortTimestamp: Date.parse(project.updatedAt),
              timestamps: {
                updatedAt: project.updatedAt,
                viewedAt: undefined,
              },
            })) ?? [])
        : [],
    hasMore: () => enabled() && query.hasNextPage,
    isLoadingMore: () => enabled() && query.isFetchingNextPage,
    loadMore: async () => {
      if (enabled() && query.hasNextPage && !query.isFetchingNextPage)
        await query.fetchNextPage();
    },
  };
}
