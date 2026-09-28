import { describe, expect, it, vi } from 'vitest';
import { assignProjectTasks } from './assignment';

describe('project task assignment', () => {
  it('preserves successful task results when a later batch fails', async () => {
    const tasks = Array.from({ length: 105 }, (_, index) => `task-${index}`);
    const assign = vi.fn(async (_id: string, ids: string[]) =>
      ids.map((taskId) => ({ taskId }))
    );
    assign
      .mockImplementationOnce(async (_id, ids) =>
        ids.map((taskId) => ({ taskId }))
      )
      .mockRejectedValueOnce(new Error('access changed'));
    const results = await assignProjectTasks(
      { assign, clear: vi.fn() },
      'initiative',
      [...tasks, tasks[0]]
    );
    expect(assign).toHaveBeenCalledTimes(2);
    expect(
      results.filter((result) => result.error).map((result) => result.taskId)
    ).toEqual(tasks.slice(100));
    expect(
      results.filter((result) => !result.error).map((result) => result.taskId)
    ).toEqual(tasks.slice(0, 100));
    expect(results).toHaveLength(105);
  });

  it('returns per-task removal failures without discarding successes', async () => {
    const clear = vi.fn(async (id: string) => {
      if (id === 'locked') throw new Error('forbidden');
    });
    const results = await assignProjectTasks(
      { assign: vi.fn(), clear },
      undefined,
      ['editable', 'locked']
    );
    expect(results[0]).toEqual({ taskId: 'editable', error: undefined });
    expect(results[1].error).toBeTruthy();
  });
});
