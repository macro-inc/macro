import { expect, it, vi } from 'vitest';
import { createBlockPreloader } from './block-preload';

function setup(components: Record<string, unknown>, stored = '[]') {
  const jobs: (() => void)[] = [];
  const cancelled: (() => void)[] = [];
  let busy = true;
  const writes = vi.fn();
  const preloader = createBlockPreloader({
    components,
    userId: 'viewer',
    storage: { getItem: () => stored, setItem: writes },
    busy: () => busy,
    schedule: (run) => {
      jobs.push(run);
      return () => {
        cancelled.push(run);
        jobs.splice(jobs.indexOf(run), 1);
      };
    },
  });
  return {
    preloader,
    jobs,
    cancelled,
    writes,
    setBusy: (value: boolean) => {
      busy = value;
    },
  };
}

it('admits no warming while view requests are busy and checks again at idle delivery', () => {
  const load = vi.fn(async () => {});
  const { preloader, jobs, setBusy } = setup({
    md: Object.assign(() => null, { preload: load }),
  });
  preloader.start();
  expect(jobs).toHaveLength(0);
  setBusy(false);
  preloader.resume();
  expect(jobs).toHaveLength(1);
  setBusy(true);
  jobs.shift()?.();
  expect(load).not.toHaveBeenCalled();
  preloader.dispose();
});

it('warms one module at a time in remembered type order', async () => {
  const pending = Promise.withResolvers<void>();
  const calls: string[] = [];
  const { preloader, jobs, setBusy } = setup(
    {
      md: Object.assign(() => null, {
        preload: async () => {
          calls.push('md');
        },
      }),
      email: Object.assign(() => null, {
        preload: async () => {
          calls.push('email');
          await pending.promise;
        },
      }),
    },
    '["email"]'
  );
  setBusy(false);
  preloader.start();
  jobs.shift()?.();
  expect(calls).toEqual(['email']);
  preloader.resume();
  expect(jobs).toHaveLength(0);
  pending.resolve();
  await pending.promise;
  // The lazy component's promise and the scheduler's phase settle in order.
  await new Promise<void>((resolve) =>
    queueMicrotask(() => queueMicrotask(resolve))
  );
  jobs.shift()?.();
  expect(calls).toEqual(['email', 'md']);
  preloader.dispose();
});

it('disposal cancels admission, including a callback delivered after cancellation', () => {
  const load = vi.fn(async () => {});
  const { preloader, jobs, cancelled, setBusy } = setup({
    md: Object.assign(() => null, { preload: load }),
  });
  setBusy(false);
  preloader.start();
  const stale = jobs[0];
  preloader.dispose();
  expect(cancelled).toHaveLength(1);
  stale?.();
  expect(load).not.toHaveBeenCalled();
});

it('pauses for navigation and resumes without waiting on a trace callback', () => {
  const { preloader, jobs, setBusy } = setup({ md: () => null });
  setBusy(false);
  preloader.pause(true);
  preloader.start();
  expect(jobs).toHaveLength(0);
  preloader.pause(false);
  expect(jobs).toHaveLength(1);
  preloader.stop();
  expect(jobs).toHaveLength(0);
  preloader.dispose();
});

it('persists only recent known type names in this account scope', () => {
  const { preloader, writes } = setup({ md: () => null, email: () => null });
  preloader.remember('md');
  preloader.remember('email');
  preloader.remember('document-id');
  expect(writes).toHaveBeenLastCalledWith(
    'block-preloads:viewer',
    '["email","md"]'
  );
  preloader.dispose();
});

it('does not warm or write storage for an anonymous scope', () => {
  const schedule = vi.fn();
  const setItem = vi.fn();
  const preloader = createBlockPreloader({
    components: { md: () => null },
    userId: undefined,
    storage: { getItem: () => '[]', setItem },
    schedule,
    busy: () => false,
  });
  preloader.start();
  preloader.remember('md');
  expect(schedule).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
  preloader.dispose();
});
