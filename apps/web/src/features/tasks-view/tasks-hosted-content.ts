import type { SplitRouteMatch } from '@app/lib/split-router';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

const hostedDetailRoutes = {
  pr: (id: string): SplitRouteMatch => ({
    id: 'tasks-pr',
    params: { foreignEntityId: id },
  }),
} satisfies Record<string, (id: string) => SplitRouteMatch>;

/** Open a Tasks-hosted detail without mounting its legacy block. */
export function tasksHostedContent(content: {
  type: string;
  id: string;
}): SplitContent | undefined {
  const detail = hostedDetailRoutes[
    content.type as keyof typeof hostedDetailRoutes
  ]?.(content.id);
  if (!detail) return;

  return {
    type: 'component',
    id: 'tasks',
    entryMetadata: {
      route: { matches: [{ id: 'view-tasks', params: {} }, detail] },
    },
  };
}
