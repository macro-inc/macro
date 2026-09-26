import { describe, expect, it, vi } from 'vitest';
import { createProjectTaskComposerCallbacks } from './project-task-composer';

describe('project task creation integration', () => {
  it('associates continued tasks without replacing the task split', async () => {
    const assignTasks = vi.fn(async () => [{ taskId: 'task' }]);
    const openProjectTasks = vi.fn();
    const callbacks = createProjectTaskComposerCallbacks({
      projectId: 'project',
      assignTasks,
      openProjectTasks,
      reportFailure: vi.fn(),
    });

    await callbacks.onTaskCreated({ documentId: 'task' });

    expect(assignTasks).toHaveBeenCalledWith('project', ['task']);
    expect(openProjectTasks).not.toHaveBeenCalled();
    callbacks.onSuccess();
    expect(openProjectTasks).toHaveBeenCalledTimes(1);
  });

  it('keeps the created task usable when project access changes', async () => {
    const reportFailure = vi.fn();
    const openProjectTasks = vi.fn();
    const callbacks = createProjectTaskComposerCallbacks({
      projectId: 'project',
      assignTasks: async () => {
        throw new Error('Forbidden');
      },
      openProjectTasks,
      reportFailure,
    });

    await expect(
      callbacks.onTaskCreated({ documentId: 'task' })
    ).resolves.toBeUndefined();
    callbacks.onSuccess();

    expect(reportFailure).toHaveBeenCalledWith(
      expect.stringContaining('Task created, but could not be added')
    );
    expect(openProjectTasks).toHaveBeenCalledTimes(1);
  });
});
