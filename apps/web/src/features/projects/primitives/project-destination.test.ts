import type { DestinationTaskComposer } from '@app/features/command/create-destination';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, type Mock, vi } from 'vitest';
import type { ProjectAccess, ProjectDetail } from '../core/project';
import { createProjectDestination } from './project-destination';

function project(
  access: ProjectAccess = 'edit',
  name = 'Launch'
): ProjectDetail {
  return {
    id: 'project-id',
    name,
    descriptionDocumentId: 'description',
    updatedAt: '',
    createdAt: '',
    ownerId: 'owner',
    memberIds: [],
    taskIds: [],
    access,
  };
}

/** Runs the destination under an owner, as the project route does. */
function withDestination(
  run: (
    setProject: (value: ProjectDetail | undefined) => void,
    destination: ReturnType<typeof createProjectDestination>,
    taskComposer: Mock<(project: ProjectDetail) => DestinationTaskComposer>
  ) => void
) {
  createRoot((dispose) => {
    const [current, setCurrent] = createSignal<ProjectDetail>();
    const taskComposer = vi.fn(
      (_: ProjectDetail): DestinationTaskComposer => ({})
    );
    const destination = createProjectDestination(current, taskComposer);
    run(setCurrent, destination, taskComposer);
    dispose();
  });
}

describe('project create destination', () => {
  it('waits for the project, then offers its composer under its name', () =>
    withDestination((setProject, destination, taskComposer) => {
      expect(destination()).toBeUndefined();
      const loaded = project();
      setProject(loaded);
      expect(destination()?.label).toBe('Launch');
      expect(taskComposer).toHaveBeenCalledExactlyOnceWith(loaded);
    }));

  it('builds the composer once per project, not once per read', () =>
    withDestination((setProject, destination, taskComposer) => {
      setProject(project());
      const first = destination();
      expect(destination()).toBe(first);
      expect(taskComposer).toHaveBeenCalledOnce();

      setProject(project('edit', 'Renamed'));
      expect(destination()?.label).toBe('Renamed');
      expect(taskComposer).toHaveBeenCalledTimes(2);
    }));

  it('names a blank project the way lists do', () =>
    withDestination((setProject, destination) => {
      setProject(project('owner', ''));
      expect(destination()?.label).toBe('Untitled project');
    }));

  it.each(['view', 'comment'] as const)(
    'is withdrawn for a viewer with %s access',
    (access) =>
      withDestination((setProject, destination, taskComposer) => {
        setProject(project(access));
        expect(destination()).toBeUndefined();
        expect(taskComposer).not.toHaveBeenCalled();
      })
  );
});
