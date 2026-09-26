import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectsContext } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import { createProjectComposer } from './create-project';

const project: ProjectDetail = {
  id: 'project-id',
  name: 'Release',
  descriptionDocumentId: 'description',
  updatedAt: '',
  createdAt: '',
  ownerId: 'owner',
  memberIds: [],
  taskIds: [],
  access: 'owner',
  sharing: {},
};
function commands() {
  return {
    pending: () => false,
    create: vi.fn(async () => project),
    rename: vi.fn(async () => {}),
    share: vi.fn(async () => {}),
    setMembers: vi.fn(async () => {}),
    assignTasks: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    saveProperty: vi.fn(async () => {}),
  } satisfies ReturnType<ProjectsContext['createCommands']>;
}

describe('project creation', () => {
  it('defaults team sharing and leaves unset properties to canonical server defaults', async () => {
    await new Promise<void>((resolve, reject) =>
      createRoot((dispose) => {
        const service = commands();
        const complete = vi.fn();
        const composer = createProjectComposer(service, complete);
        composer.setName('  Release  ');
        composer
          .submit()
          .then(() => {
            expect(service.create).toHaveBeenCalledWith({
              name: 'Release',
              shareWithTeam: true,
            });
            expect(service.saveProperty).not.toHaveBeenCalled();
            expect(complete).toHaveBeenCalledWith('project-id');
            dispose();
            resolve();
          })
          .catch(reject);
      })
    );
  });

  it('retries a failed property write on the existing project without duplicating creation', async () => {
    await new Promise<void>((resolve, reject) =>
      createRoot((dispose) => {
        const service = commands();
        service.saveProperty.mockRejectedValueOnce(new Error('offline'));
        const complete = vi.fn();
        const composer = createProjectComposer(service, complete);
        composer.setName('Release');
        composer.saveDraft(
          {
            propertyId: 'due',
            propertyDefinitionId: 'due',
            displayName: 'Due date',
            valueType: 'DATE',
            value: null,
            isMultiSelect: false,
            isMetadata: false,
            isSystemProperty: true,
            owner: { scope: 'system' },
            createdAt: '',
            updatedAt: '',
          },
          { valueType: 'DATE', value: new Date('2026-10-01T00:00:00Z') }
        );
        composer
          .submit()
          .then(async () => {
            expect(composer.createdId()).toBe('project-id');
            expect(composer.error()).toContain('Retry');
            expect(complete).not.toHaveBeenCalled();
            await composer.submit();
            expect(service.create).toHaveBeenCalledTimes(1);
            expect(service.saveProperty).toHaveBeenCalledTimes(2);
            expect(complete).toHaveBeenCalledWith('project-id');
            dispose();
            resolve();
          })
          .catch(reject);
      })
    );
  });
});
