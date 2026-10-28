import { canDeleteProject, canEditProject, type Project } from './project';

/** Entries of a project row's context menu. */
export type ProjectMenuItem =
  | 'open-in-split'
  | 'rename'
  | 'status'
  | 'priority'
  | 'copy-link'
  | 'copy-id'
  | 'share'
  | 'delete';

/**
 * The entries every target allows, in separator-delimited groups. Actions on
 * one project's identity drop out of a multi-project menu, and `surface`
 * removes entries the host cannot offer yet, such as unloaded properties.
 */
export function projectMenuGroups(
  projects: readonly Pick<Project, 'access'>[],
  surface: {
    splits: boolean;
    share: boolean;
    status: boolean;
    priority: boolean;
  }
): ProjectMenuItem[][] {
  if (projects.length === 0) return [];
  const single = projects.length === 1;
  const editable = projects.every(canEditProject);
  const groups: ProjectMenuItem[][] = [
    single && surface.splits ? ['open-in-split'] : [],
    editable
      ? [
          ...(single ? (['rename'] as const) : []),
          ...(surface.status ? (['status'] as const) : []),
          ...(surface.priority ? (['priority'] as const) : []),
        ]
      : [],
    single
      ? ['copy-link', 'copy-id', ...(surface.share ? (['share'] as const) : [])]
      : [],
    projects.every(canDeleteProject) ? ['delete'] : [],
  ];
  return groups.filter((group) => group.length > 0);
}
