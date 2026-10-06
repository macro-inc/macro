import { describe, expect, it, vi } from 'vitest';
import { assignProjectTasks } from './assignment';

describe('project task assignment', () => {
  it('sets each unique task once and keeps successes when some fail', async () => {
    const tasks = Array.from({ length: 30 }, (_, index) => `task-${index}`);
    const setProject = vi.fn(async (taskId: string) => {
      if (taskId === 'task-27') throw new Error('access changed');
    });
    const results = await assignProjectTasks(setProject, 'initiative', [
      ...tasks,
      tasks[0],
    ]);
    expect(setProject).toHaveBeenCalledTimes(30);
    expect(setProject).toHaveBeenCalledWith('task-0', 'initiative');
    expect(
      results.filter((result) => result.error).map((result) => result.taskId)
    ).toEqual(['task-27']);
    expect(results).toHaveLength(30);
  });

  it('clears the project and reports per-task removal failures', async () => {
    const setProject = vi.fn(async (id: string) => {
      if (id === 'locked') throw new Error('forbidden');
    });
    const results = await assignProjectTasks(setProject, undefined, [
      'editable',
      'locked',
    ]);
    expect(setProject).toHaveBeenCalledWith('editable', undefined);
    expect(results[0]).toEqual({ taskId: 'editable', error: undefined });
    expect(results[1].error).toBeTruthy();
  });
});
