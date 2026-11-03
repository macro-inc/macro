import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createDateClock } from './createDateClock';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('ticks at boundaries only while enabled and visible, and catches up on return', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:30Z'));
  const hidden = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  const state = createRoot((dispose) => {
    const [enabled, setEnabled] = createSignal(false);
    return { now: createDateClock(enabled, 60_000), setEnabled, dispose };
  });
  expect(vi.getTimerCount()).toBe(0);
  state.setEnabled(true);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(29_999);
  expect(state.now()).toBe(Date.parse('2026-10-01T12:00:00Z'));
  vi.advanceTimersByTime(1);
  expect(state.now()).toBe(Date.parse('2026-10-01T12:01:00Z'));
  hidden.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(120_000);
  hidden.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(state.now()).toBe(Date.parse('2026-10-01T12:03:00Z'));
  state.setEnabled(false);
  expect(vi.getTimerCount()).toBe(0);
  state.dispose();
});
