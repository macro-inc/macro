import type { Client } from '@urql/core';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const activity = vi.hoisted(() => ({
  refresh: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('@queries/activity/push-registry', () => ({
  registerActivityRevalidator: (entry: { refresh: () => Promise<void> }) => {
    activity.refresh = entry.refresh;
    return () => {
      activity.refresh = undefined;
    };
  },
  revalidateActivityQueries: async () => {},
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: async () => {},
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => undefined,
  getGraphqlSoupClient: () => {
    throw new Error('The test must inject a client');
  },
}));

import { registerProjectRevalidation } from './project-revalidation';

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** A project read that stays in flight until the test answers it. */
function register(enabled = () => true) {
  const answers: (() => void)[] = [];
  const read = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        answers.push(resolve);
      })
  );
  const dispose = createRoot((dispose) => {
    registerProjectRevalidation(() => ({}) as Client, enabled, read);
    return dispose;
  });
  const answer = async () => {
    for (const resolve of answers.splice(0)) resolve();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { read, answer, dispose };
}

it('sends no read 30 s, or any time, after the last one', async () => {
  const { read, answer, dispose } = register();

  await vi.advanceTimersByTimeAsync(30_000);
  expect(read).not.toHaveBeenCalled();

  // Not after a push's read either.
  const pushed = activity.refresh?.();
  await vi.advanceTimersByTimeAsync(0);
  await answer();
  await pushed;
  expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(read).toHaveBeenCalledOnce();
  dispose();
});

it('sends no read when the window gains focus or the tab is shown', async () => {
  const { read, dispose } = register();

  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).not.toHaveBeenCalled();

  setVisibility('hidden');
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  setVisibility('visible');
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).not.toHaveBeenCalled();
  dispose();
});

it('reads once per activity revalidation, and once more for those during it', async () => {
  const { read, answer, dispose } = register();

  const first = activity.refresh?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledOnce();

  // Pushes that arrive while the read is in flight share one trailing read.
  const second = activity.refresh?.();
  const third = activity.refresh?.();
  await answer();
  expect(read).toHaveBeenCalledTimes(2);
  await answer();
  await Promise.all([first, second, third]);
  expect(read).toHaveBeenCalledTimes(2);
  dispose();
});

it('stays quiet when disabled or disposed', async () => {
  const disabled = register(() => false);
  await disabled.answer();
  await activity.refresh?.();
  expect(disabled.read).not.toHaveBeenCalled();
  disabled.dispose();

  const disposed = register();
  disposed.dispose();
  expect(activity.refresh).toBeUndefined();
  await vi.advanceTimersByTimeAsync(60_000);
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(disposed.read).not.toHaveBeenCalled();
});

it('drops a queued read when disposed during the one in flight', async () => {
  const { read, answer, dispose } = register();
  const refresh = activity.refresh;
  const first = refresh?.();
  await vi.advanceTimersByTimeAsync(0);
  const queued = refresh?.();
  expect(read).toHaveBeenCalledOnce();

  dispose();
  await answer();
  await Promise.all([first, queued]);
  expect(read).toHaveBeenCalledOnce();
});
