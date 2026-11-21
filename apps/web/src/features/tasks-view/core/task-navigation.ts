import type { ProjectScope } from '../../projects/core/project';
import type { ProjectTab, TasksTab } from '../types';

export const TASK_TAB_IDS = [
  'my-tasks',
  'created-by-me',
  'team-tasks',
  'projects',
  'my-projects',
  'created-projects',
] as const;

export function isProjectTab(tab: string | undefined): tab is ProjectTab {
  return (
    tab === 'projects' || tab === 'my-projects' || tab === 'created-projects'
  );
}

export function projectScopeForTab(tab: TasksTab): ProjectScope {
  if (tab === 'my-projects') return 'assigned-to-me';
  if (tab === 'created-projects') return 'created-by-me';
  return 'all';
}

export function projectTabForScope(scope: ProjectScope): ProjectTab {
  if (scope === 'assigned-to-me') return 'my-projects';
  if (scope === 'created-by-me') return 'created-projects';
  return 'projects';
}
