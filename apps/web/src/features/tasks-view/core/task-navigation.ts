import type { ProjectScope } from '../../projects/core/project';
import type { ProjectTab, TasksTab } from '../types';

export const TASK_TAB_IDS = [
  'my-tasks',
  'team-tasks',
  'projects',
  'my-projects',
] as const;

/** Translate deployed tab identifiers only when reading external navigation. */
export function normalizeTaskTab(tab: unknown): unknown {
  if (tab === 'created-by-me') return 'my-tasks';
  if (tab === 'created-projects') return 'my-projects';
  return tab;
}

export function isProjectTab(tab: unknown): tab is ProjectTab {
  return tab === 'projects' || tab === 'my-projects';
}

export function projectScopeForTab(tab: TasksTab): ProjectScope {
  if (tab === 'my-projects') return 'assigned-to-me';
  return 'all';
}

export function projectTabForScope(scope: ProjectScope): ProjectTab {
  if (scope === 'assigned-to-me') return 'my-projects';
  return 'projects';
}
