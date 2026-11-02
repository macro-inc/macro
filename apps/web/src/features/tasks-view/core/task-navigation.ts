import type { ProjectTab, TasksTab } from '../types';

export const TASK_TAB_IDS = [
  'my-tasks',
  'created-by-me',
  'team-tasks',
  'projects',
  'my-projects',
  'created-projects',
] as const;

export function isProjectTab(tab: TasksTab): tab is ProjectTab {
  return (
    tab === 'projects' || tab === 'my-projects' || tab === 'created-projects'
  );
}
