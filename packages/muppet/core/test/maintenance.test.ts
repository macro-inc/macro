import { expect, test } from 'bun:test';
import {
  maintenance,
  maintenanceReceipts,
  trackMaintenanceTask,
} from '../maintenance.ts';

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

test('a failed drain receipt is retried on the next fence refresh', async () => {
  const control = maintenance();
  control.eligible(true);
  const failed = Promise.withResolvers<void>();
  const delivered = Promise.withResolvers<void>();
  let refresh = () => {};
  let attempts = 0;
  const ready = maintenanceReceipts({
    control,
    invocation: 'one',
    runtime: 'image',
    readFence: () => 'update',
    watchFence: (listener) => {
      refresh = listener;
    },
    write: async (name) => {
      if (name === 'ready') return;
      attempts += 1;
      if (attempts === 1) throw new Error('temporary write failure');
      delivered.resolve();
    },
    onError: () => failed.resolve(),
  });
  await ready('head');
  await failed.promise;
  await Promise.resolve();
  expect(attempts).toBe(1);
  refresh();
  await delivered.promise;
  expect(attempts).toBe(2);
});
