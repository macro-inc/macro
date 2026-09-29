import type { Property } from '@property/types';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  ProjectCreationInput,
  ProjectCreationResult,
  ProjectsContext,
} from '../context/projects-context';
import { createProjectComposer } from './create-project';

const dueDate: Property = {
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
};
const dueValue = {
  valueType: 'DATE' as const,
  value: new Date('2026-10-01T00:00:00Z'),
};
function commands() {
  return {
    createTask: vi.fn(async () => null),
    pending: () => false,
    create: vi.fn(
      async (_input: ProjectCreationInput): Promise<ProjectCreationResult> => ({
        status: 'created',
        id: 'project-id',
      })
    ),
    rename: vi.fn(async () => {}),
    setMembers: vi.fn(async () => {}),
    assignTasks: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    saveProperty: vi.fn(async () => {}),
  } satisfies ReturnType<ProjectsContext['createCommands']>;
}
function withComposer(run: () => Promise<void>): Promise<void> {
  return createRoot(async (dispose) => {
    try {
      await run();
    } finally {
      dispose();
    }
  });
}

describe('project creation', () => {
  it('defaults team sharing and leaves unset properties to canonical server defaults', () =>
    withComposer(async () => {
      const service = commands();
      const complete = vi.fn();
      const composer = createProjectComposer(service, complete);
      composer.setName('  Release  ');
      const submission = composer.submit();
      // Submission starts synchronously, so the caller can close right away.
      expect(composer.pending()).toBe(true);
      expect(composer.submit()).toBeUndefined();
      expect(service.create).toHaveBeenCalledWith({
        name: 'Release',
        shareWithTeam: true,
        properties: [],
        createdId: undefined,
      });
      expect(await submission).toEqual({ status: 'created', id: 'project-id' });
      expect(composer.pending()).toBe(false);
      expect(complete).toHaveBeenCalledWith('project-id');
    }));

  it('does not submit an unnamed project', () =>
    withComposer(async () => {
      const service = commands();
      const composer = createProjectComposer(service, vi.fn());
      composer.setName('   ');
      expect(composer.submit()).toBeUndefined();
      expect(composer.pending()).toBe(false);
      expect(service.create).not.toHaveBeenCalled();
    }));

  it('retries a failed property write on the existing project without duplicating creation', () =>
    withComposer(async () => {
      const service = commands();
      service.create.mockResolvedValueOnce({
        status: 'propertiesFailed',
        id: 'project-id',
        error: new Error('offline'),
      });
      const complete = vi.fn();
      const composer = createProjectComposer(service, complete);
      composer.setName('Release');
      composer.saveDraft(dueDate, dueValue);
      await composer.submit();
      expect(composer.createdId()).toBe('project-id');
      expect(composer.error()).toContain('Retry');
      expect(complete).not.toHaveBeenCalled();
      await composer.submit();
      expect(service.create).toHaveBeenCalledTimes(2);
      expect(service.create).toHaveBeenLastCalledWith({
        name: 'Release',
        shareWithTeam: true,
        properties: [{ property: dueDate, value: dueValue }],
        createdId: 'project-id',
      });
      expect(composer.error()).toBeUndefined();
      expect(complete).toHaveBeenCalledWith('project-id');
    }));

  it('keeps a failed draft editable and reports the server error', () =>
    withComposer(async () => {
      const service = commands();
      service.create.mockResolvedValueOnce({
        status: 'failed',
        error: new Error('Name is too long'),
      });
      const complete = vi.fn();
      const composer = createProjectComposer(service, complete);
      composer.setName('Release');
      expect(await composer.submit()).toMatchObject({ status: 'failed' });
      expect(composer.createdId()).toBeUndefined();
      expect(composer.error()).toBe('Name is too long');
      expect(composer.snapshot()).toMatchObject({
        name: 'Release',
        error: 'Name is too long',
      });
      expect(complete).not.toHaveBeenCalled();
    }));

  it('settles and records the outcome after its owner is disposed', async () => {
    const service = commands();
    let resolve!: (result: ProjectCreationResult) => void;
    service.create.mockReturnValueOnce(
      new Promise((settle) => {
        resolve = settle;
      })
    );
    const complete = vi.fn();
    const { composer, submission } = createRoot((dispose) => {
      const composer = createProjectComposer(service, complete);
      composer.setName('Release');
      const submission = composer.submit();
      // Closing the composer disposes its owner while the request is in flight.
      dispose();
      return { composer, submission };
    });
    resolve({
      status: 'propertiesFailed',
      id: 'project-id',
      error: new Error('offline'),
    });
    await submission;
    expect(composer.snapshot()).toMatchObject({
      name: 'Release',
      createdId: 'project-id',
    });
    expect(complete).not.toHaveBeenCalled();
  });
});
