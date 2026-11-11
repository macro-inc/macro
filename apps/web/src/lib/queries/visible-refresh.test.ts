import { afterEach, expect, it, vi } from 'vitest';
import { createHiddenDeferral, createVisibleRefresh } from './visible-refresh';

const setVisibility = (value: DocumentVisibilityState) => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
};
const dispatch = () => document.dispatchEvent(new Event('visibilitychange'));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('refreshes at once, then once more per interval for the rest of a burst', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const visible = createVisibleRefresh(refresh, { intervalMs: 2_000 });

  visible.markDirty();
  expect(refresh).toHaveBeenCalledTimes(1);

  visible.markDirty();
  visible.markDirty();
  visible.markDirty();
  vi.advanceTimersByTime(1_999);
  expect(refresh).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(2);

  vi.advanceTimersByTime(10_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  visible.dispose();
});

it('runs every request synchronously while visible', () => {
  const run = vi.fn();
  const deferral = createHiddenDeferral(run);
  deferral.request();
  deferral.request();
  expect(run).toHaveBeenCalledTimes(2);
  deferral.dispose();
});

it('coalesces hidden requests into one run on becoming visible', () => {
  setVisibility('hidden');
  const run = vi.fn();
  const deferral = createHiddenDeferral(run);
  deferral.request();
  deferral.request();
  dispatch();
  expect(run).not.toHaveBeenCalled();

  setVisibility('visible');
  dispatch();
  dispatch();
  expect(run).toHaveBeenCalledTimes(1);
  deferral.dispose();
});

it('stays quiet when shown with nothing deferred or after disposal', () => {
  const run = vi.fn();
  const deferral = createHiddenDeferral(run);
  dispatch();
  expect(run).not.toHaveBeenCalled();

  setVisibility('hidden');
  deferral.request();
  deferral.dispose();
  setVisibility('visible');
  dispatch();
  expect(run).not.toHaveBeenCalled();
});
