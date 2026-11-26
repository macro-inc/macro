import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import { isProjectTab } from '@app/features/tasks-view/core/task-navigation';
import type { SplitLocation } from '@app/lib/split-router';

/** Group Tasks workspace entries by dock destination, not their shared content id. */
export function viewRestorationKey(
  id: string,
  location?: SplitLocation
): string {
  if (parseAgentsRoute(id)) return 'agents';
  if (id !== 'tasks') return id;

  const matches = location?.route.matches;
  if (
    matches?.some(
      (match) =>
        match.id === 'tasks-projects' ||
        match.id === 'tasks-project' ||
        match.id === 'tasks-project-task'
    ) ||
    (matches?.at(-1)?.id === 'view-tasks' &&
      isProjectTab(location?.search?.tasks?.tab?.[0]))
  ) {
    return 'projects';
  }
  return 'tasks';
}
