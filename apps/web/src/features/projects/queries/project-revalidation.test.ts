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

const POLL_MS = 30_000;
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

it('polls a visible project 30 s after its last read', async () => {
  const { read, answer, dispose } = register();

  await vi.advanceTimersByTimeAsync(POLL_MS - 1);
  expect(read).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledOnce();
  await answer();

  // An activity push reads too, so the next poll waits a full interval after it.
  await vi.advanceTimersByTimeAsync(10_000);
  const pushed = activity.refresh?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
  await answer();
  await pushed;
  await vi.advanceTimersByTimeAsync(POLL_MS - 1);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(3);
  dispose();
});

it('sends no polls while hidden and reads once when shown and focused', async () => {
  const { read, answer, dispose } = register();
  setVisibility('hidden');

  await vi.advanceTimersByTimeAsync(3 * POLL_MS);
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).not.toHaveBeenCalled();

  // Becoming visible catches up, and the focus that follows shares that read.
  setVisibility('visible');
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledOnce();
  await answer();

  await vi.advanceTimersByTimeAsync(POLL_MS - 1);
  expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
  dispose();
});

it('reads on focus but not on a show with no poll due', async () => {
  const { read, answer, dispose } = register();
  setVisibility('hidden');
  await vi.advanceTimersByTimeAsync(POLL_MS / 2);
  setVisibility('visible');
  await vi.advanceTimersByTimeAsync(0);
  expect(read).not.toHaveBeenCalled();

  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledOnce();
  await answer();
  dispose();
});

it('stays quiet when disabled or disposed', async () => {
  const disabled = register(() => false);
  await vi.advanceTimersByTimeAsync(2 * POLL_MS);
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(disabled.read).not.toHaveBeenCalled();
  disabled.dispose();

  const disposed = register();
  setVisibility('hidden');
  await vi.advanceTimersByTimeAsync(POLL_MS);
  disposed.dispose();
  setVisibility('visible');
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(2 * POLL_MS);
  expect(disposed.read).not.toHaveBeenCalled();
});
