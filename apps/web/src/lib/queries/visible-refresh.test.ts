import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createHiddenDeferral,
  createVisibleRefresh,
  intervalWhileRead,
} from './visible-refresh';

const setVisibility = (value: DocumentVisibilityState) => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
};
const dispatch = () => document.dispatchEvent(new Event('visibilitychange'));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('refreshes at once after a quiet interval and never closer together than it', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const visible = createVisibleRefresh(refresh, { intervalMs: 2_000 });

  visible.markDirty();
  expect(refresh).toHaveBeenCalledTimes(1);

  visible.markDirty();
  visible.markDirty();
  vi.advanceTimersByTime(1_999);
  expect(refresh).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(2);

  // A change right after a delayed refresh waits out the interval too.
  vi.advanceTimersByTime(1);
  visible.markDirty();
  expect(refresh).toHaveBeenCalledTimes(2);

  vi.advanceTimersByTime(1_999);
  expect(refresh).toHaveBeenCalledTimes(2);

  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(3);

  vi.advanceTimersByTime(2_000);
  visible.markDirty();
  expect(refresh).toHaveBeenCalledTimes(4);
  visible.dispose();
});

it('reads a function interval when it schedules, moving a pending refresh earlier when it shrinks', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const [reading, setReading] = createSignal(false);
  const visible = createVisibleRefresh(refresh, {
    intervalMs: intervalWhileRead(reading, 2_000),
  });

  visible.markDirty();
  visible.markDirty();
  expect(refresh).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(500);
  setReading(true);
  vi.advanceTimersByTime(1_000);
  expect(refresh).toHaveBeenCalledOnce();

  visible.markDirty();
  vi.advanceTimersByTime(1_999);
  expect(refresh).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);

  setReading(false);
  visible.markDirty();
  visible.markDirty();
  expect(refresh).toHaveBeenCalledTimes(3);
  setReading(true);
  vi.advanceTimersByTime(59_999);
  expect(refresh).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(4);
  visible.dispose();
});

it('waits out a grown interval before a pending refresh starts', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const [reading, setReading] = createSignal(true);
  const visible = createVisibleRefresh(refresh, {
    intervalMs: intervalWhileRead(reading, 2_000),
  });

  visible.markDirty();
  vi.advanceTimersByTime(100);
  visible.markDirty();
  vi.advanceTimersByTime(900);
  setReading(false);
  vi.advanceTimersByTime(1_100);
  expect(refresh).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(57_899);
  expect(refresh).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1);
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
