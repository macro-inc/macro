import { expect, test } from 'bun:test';
import { maintenance, trackMaintenanceTask } from '../maintenance.ts';

test('a fence drains detached work and delivers queued work after release', async () => {
  const control = maintenance();
  control.eligible(true);
  const task = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const calls: string[] = [];

  await control.dispatch(false, async () => {
    void trackMaintenanceTask(async () => {
      await task.promise;
      await control.dispatch(true, async () => {
        calls.push('work finished');
      });
    });
  });
  control.setFence('update');
  const queued = control.dispatch(false, async () => {
    calls.push('queued event');
    released.resolve();
  });
  expect(control.drained()).toBeUndefined();

  const drained = Promise.withResolvers<void>();
  control.change(() => {
    if (control.drained() === 'update') drained.resolve();
  });
  task.resolve();
  await drained.promise;
  expect(calls).toEqual(['work finished']);

  control.setFence(undefined);
  await Promise.all([queued, released.promise]);
  expect(calls).toEqual(['work finished', 'queued event']);
});

test('a timeout can release queued work without waiting for the active task', async () => {
  const control = maintenance();
  control.eligible(true);
  const task = Promise.withResolvers<void>();
  const active = control.dispatch(false, () => task.promise);

  control.setFence('update');
  const queued = control.dispatch(false, async () => 'delivered');
  expect(control.drained()).toBeUndefined();
  control.setFence(undefined);
  expect(await queued).toBe('delivered');
  task.resolve();
  await active;
});

test('unclassified sources cannot report a drained invocation', () => {
  const control = maintenance();
  control.eligible(false);
  control.setFence('update');
  expect(control.drained()).toBeUndefined();
});
