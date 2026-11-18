import {
  groupMenuItems,
  type MenuGroup,
} from '../../../lib/core/menu/group-menu-items';
import { canDeleteProject, canEditProject, type Project } from './project';

/** Entries of a project row's context menu. */
export type ProjectMenuItem =
  | 'open-in-split'
  | 'open-in-tab'
  | 'rename'
  | 'change-icon'
  | 'status'
  | 'priority'
  | 'copy-link'
  | 'copy-id'
  | 'share'
  | 'delete';

/** The entries every target allows, grouped in semantic action order. */
export function projectMenuGroups(
  projects: readonly Pick<Project, 'access'>[],
  surface: {
    splits: boolean;
    tabs: boolean;
    share: boolean;
    status: boolean;
    priority: boolean;
    appearance?: boolean;
  }
): ProjectMenuItem[][] {
  if (projects.length === 0) return [];
  const single = projects.length === 1;
  const editable = projects.every(canEditProject);
  const items: ProjectMenuItem[] = [
    ...(single && surface.splits ? (['open-in-split'] as const) : []),
    ...(single && surface.tabs ? (['open-in-tab'] as const) : []),
    ...(single && surface.share ? (['share'] as const) : []),
    ...(single ? (['copy-link', 'copy-id'] as const) : []),
    ...(editable && single ? (['rename'] as const) : []),
    ...(editable && single && surface.appearance
      ? (['change-icon'] as const)
      : []),
    ...(editable && surface.status ? (['status'] as const) : []),
    ...(editable && surface.priority ? (['priority'] as const) : []),
    ...(projects.every(canDeleteProject) ? (['delete'] as const) : []),
  ];
  return groupMenuItems(items, (item): MenuGroup => {
    if (item === 'open-in-split' || item === 'open-in-tab') return 'open';
    if (item === 'share') return 'most-used';
    if (item === 'copy-link' || item === 'copy-id') return 'copy';
    if (item === 'delete') return 'delete';
    return 'modify';
  }).map((group) => group.items);
}
