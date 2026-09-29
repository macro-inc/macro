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

/** A menu on one of several selected rows acts on the selection, as in Tasks. */
export function projectMenuTargets<T extends { id: string }>(
  clicked: T,
  selected: readonly T[]
): readonly T[] {
  return selected.length > 1 && selected.some((row) => row.id === clicked.id)
    ? selected
    : [clicked];
}

/**
 * The entries every target allows, in separator-delimited groups. Actions on
 * one project's identity drop out of a multi-project menu.
 */
export function projectMenuGroups(
  projects: readonly Pick<Project, 'access'>[],
  surface: { splits: boolean; share: boolean }
): ProjectMenuItem[][] {
  if (projects.length === 0) return [];
  const single = projects.length === 1;
  const editable = projects.every(canEditProject);
  const groups: ProjectMenuItem[][] = [
    single && surface.splits ? ['open-in-split'] : [],
    [
      ...(single && editable ? (['rename'] as const) : []),
      ...(editable ? (['status', 'priority'] as const) : []),
    ],
    single
      ? ['copy-link', 'copy-id', ...(surface.share ? (['share'] as const) : [])]
      : [],
    projects.every(canDeleteProject) ? ['delete'] : [],
  ];
  return groups.filter((group) => group.length > 0);
}
