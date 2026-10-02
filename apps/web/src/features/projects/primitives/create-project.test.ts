import type { Property } from '@property/types';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectsContext } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import { createProjectComposer, failedProjectDraft } from './create-project';

const project: ProjectDetail = {
  id: 'project-id',
  name: 'Release',
  descriptionSurfaceId: 'description',
  updatedAt: '',
  createdAt: '',
  ownerId: 'owner',
  memberIds: [],
  taskIds: [],
  access: 'owner',
};
function commands() {
  return {
    createTask: vi.fn(async () => null),
    pending: () => false,
    create: vi.fn(async () => project),
    rename: vi.fn(async () => {}),
    setMembers: vi.fn(async () => {}),
    assignTasks: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    deleteMany: vi.fn(async (): Promise<string[]> => []),
    saveProperties: vi.fn(async () => {}),
    saveProperty: vi.fn(async () => {}),
  } satisfies ReturnType<ProjectsContext['createCommands']>;
}

const dueDate = {
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
} satisfies Property;
const dueValue = {
  valueType: 'DATE' as const,
  value: new Date('2026-10-01T00:00:00Z'),
};

describe('project creation', () => {
  it('submits once with its values, defaulting team sharing and leaving unset properties to the server', () =>
    createRoot(async (dispose) => {
      const service = commands();
      const composer = createProjectComposer(service);
      composer.setName('  Release  ');
      composer.saveDraft(dueDate, dueValue);
      const submission = composer.submit();
      expect(composer.pending()).toBe(true);
      expect(composer.submit()).toBeUndefined();
      expect(service.create).toHaveBeenCalledOnce();
      expect(service.create).toHaveBeenCalledWith({
        name: 'Release',
        shareWithTeam: true,
        properties: [{ property: dueDate, value: dueValue }],
      });
      expect(service.saveProperty).not.toHaveBeenCalled();
      expect(await submission?.result).toBe(project);
      dispose();
    }));

  it('does not submit an unnamed project', () =>
    createRoot((dispose) => {
      const service = commands();
      const composer = createProjectComposer(service);
      composer.setName('   ');
      expect(composer.submit()).toBeUndefined();
      expect(composer.pending()).toBe(false);
      expect(service.create).not.toHaveBeenCalled();
      dispose();
    }));

  it("reopens a failure with its draft and the server's reason", () => {
    const draft = {
      name: 'Release',
      shareWithTeam: true,
      properties: [{ property: dueDate, value: dueValue }],
    };
    expect(failedProjectDraft(draft, new Error('Name is too long'))).toEqual({
      ...draft,
      error: 'Name is too long',
    });
    expect(failedProjectDraft(draft, 'offline')).toEqual({
      ...draft,
      error: 'Could not create project.',
    });
  });
});
