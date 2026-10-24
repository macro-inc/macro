import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createTaskCalendarSignal } from './create-task-calendar';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('refreshes at midnight and rechecks the viewer timezone on resume', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T23:59:59.500Z'));
  let timeZone = 'UTC';
  const calendar = createRoot((cleanup) => {
    dispose = cleanup;
    return createTaskCalendarSignal({ timeZone: () => timeZone });
  });
  expect(calendar().today).toBe('2026-10-21');
  const firstPageCalendar = calendar();
  vi.advanceTimersByTime(500);
  expect(calendar().today).toBe('2026-10-22');
  expect(firstPageCalendar.today).toBe('2026-10-21');
  timeZone = 'America/Los_Angeles';
  window.dispatchEvent(new Event('focus'));
  expect(calendar().today).toBe('2026-10-21');
  expect(calendar().boundaries.today).toBe('2026-10-21T07:00:00.000Z');
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(calendar().today).toBe('2026-10-24');
});
