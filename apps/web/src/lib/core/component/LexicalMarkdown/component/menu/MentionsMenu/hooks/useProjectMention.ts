import { useProjectSearchQuery } from '@app/features/projects/project-search';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableProjects } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';
import type { ProjectMentionItem } from '../../../../utils/mentionsUtils';

/** Task projects come from the authorized server search, like the command menu. */
export function useProjectMention(options: {
  searchTerm: Accessor<string>;
  enabled: Accessor<boolean>;
}) {
  const userId = useUserId();
  const projectsFlag = useFeatureFlag(enableProjects);
  const enabled = () => projectsFlag().enabled && options.enabled();
  const query = useProjectSearchQuery(options.searchTerm, enabled, userId);
  const projects = createLazyMemo((): ProjectMentionItem[] =>
    enabled() && !query.error()
      ? (query.rows() ?? []).map(({ project }) => ({
          kind: 'project',
          id: project.id,
          searchText: project.name,
          // Same recency key quick access sorts documents by.
          sortTimestamp:
            Date.parse(project.viewedAt ?? '') ||
            Date.parse(project.updatedAt) ||
            0,
          timestamps: {
            updatedAt: project.updatedAt,
            viewedAt: project.viewedAt,
          },
          data: { name: project.name },
        }))
      : []
  );
  return {
    projects,
    totalCount: () => projects().length,
    hasMore: () => enabled() && query.hasMore(),
    isLoadingMore: () => enabled() && query.loadingMore(),
    loadMore: async () => {
      if (enabled() && query.hasMore() && !query.loadingMore())
        await query.loadMore();
    },
  };
}
