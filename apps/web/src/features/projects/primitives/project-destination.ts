import type {
  CreateDestination,
  DestinationTaskComposer,
} from '@app/features/command/create-destination';
import { type Accessor, createMemo } from 'solid-js';
import {
  canEditProject,
  type ProjectDetail,
  projectDisplayName,
} from '../core/project';

/**
 * Where the create menu puts a new task while this project is open. Withdrawn
 * until the project loads and for viewers who cannot add tasks to it, so their
 * tasks are created as they would be anywhere else. Memoized: the menus read it
 * on every render, and it only changes with the project.
 */
export function createProjectDestination(
  project: Accessor<ProjectDetail | undefined>,
  taskComposer: (project: ProjectDetail) => DestinationTaskComposer
): Accessor<CreateDestination | undefined> {
  return createMemo(() => {
    const current = project();
    if (!current || !canEditProject(current)) return;
    return {
      label: projectDisplayName(current),
      taskComposer: taskComposer(current),
    };
  });
}
