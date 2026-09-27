import { expect, it, vi } from 'vitest';
import { runTaskCreatedCallback } from './taskCreatedCallback';

it.each([false, true])(
  'keeps completion reachable after a failing callback (async: %s)',
  async (asynchronous) => {
    const reportFailure = vi.fn();
    const callback = vi.fn(() => {
      if (asynchronous) return Promise.reject(new Error('Assignment failed'));
      throw new Error('Assignment failed');
    });
    await expect(
      runTaskCreatedCallback(
        callback,
        { documentId: 'saved-task' },
        reportFailure
      )
    ).resolves.toBeUndefined();
    expect(reportFailure).toHaveBeenCalledWith(
      expect.stringContaining('Task created')
    );
  }
);

it('waits for the successful follow-up before task completion', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const reportFailure = vi.fn();
  const completed = vi.fn();
  const task = (async () => {
    await runTaskCreatedCallback(() => pending, 'saved-task', reportFailure);
    completed();
  })();
  expect(completed).not.toHaveBeenCalled();
  finish();
  await task;
  expect(completed).toHaveBeenCalledOnce();
  expect(reportFailure).not.toHaveBeenCalled();
});
