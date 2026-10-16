import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { Gantt } from './gantt';
import { toGanttDay } from './gantt-date';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('increases deadline urgency on calendar days but excludes undated, inactive, and clipped ends', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 2, 3, 12));
  const [end, setEnd] = createSignal<string | null>('2026-03-11');
  const [enabled, setEnabled] = createSignal(true);
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: {
        start: toGanttDay('2026-03-01')!,
        end: toGanttDay('2026-03-21')!,
      },
      defaultScale: 'day',
      get children() {
        return createComponent(Gantt.Bar, {
          start: '2026-03-01',
          get end() {
            return end();
          },
          get deadlineWarning() {
            return enabled();
          },
        });
      },
    })
  );
  const warning = () =>
    view.container.querySelector<HTMLElement>('[data-gantt-end-warning]');
  expect(warning()).toBeNull();
  setEnd('2026-03-10');
  const distant = Number(warning()!.dataset.ganttEndWarning);
  setEnd('2026-03-04');
  expect(Number(warning()!.dataset.ganttEndWarning)).toBeGreaterThan(distant);
  setEnd('2026-03-03');
  expect(Number(warning()!.dataset.ganttEndWarning)).toBe(0.35);
  setEnd('2026-03-02');
  expect(Number(warning()!.dataset.ganttEndWarning)).toBe(0.35);
  setEnabled(false);
  expect(warning()).toBeNull();
  setEnabled(true);
  setEnd(null);
  expect(warning()).toBeNull();
  vi.setSystemTime(new Date(2026, 2, 28, 12));
  fireEvent.focus(window);
  setEnd('2026-03-30');
  expect(warning()).toBeNull();
});

it('refreshes all deadline gradients and Today at local midnight and on tab resume, then clears the shared timer', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(2026, 2, 7, 23, 59, 59));
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: {
        start: toGanttDay('2026-03-01')!,
        end: toGanttDay('2026-03-21')!,
      },
      defaultScale: 'day',
      get children() {
        return [
          createComponent(Gantt.Bar, {
            start: '2026-03-01',
            end: '2026-03-15',
          }),
          createComponent(Gantt.Bar, {
            start: '2026-03-01',
            end: '2026-03-08',
          }),
          createComponent(Gantt.TodayMarker, {}),
        ];
      },
    })
  );
  const strength = (end: string) =>
    Number(
      view.container.querySelector<HTMLElement>(
        `[data-gantt-end="${toGanttDay(end)}"] [data-gantt-end-warning]`
      )?.dataset.ganttEndWarning ?? 0
    );
  const todayLeft = () =>
    Number.parseFloat(
      view.container.querySelector<HTMLElement>('[data-gantt-today]')!.style
        .left
    );
  const initialLeft = todayLeft();
  expect(strength('2026-03-15')).toBe(0);
  expect(strength('2026-03-08')).toBeLessThan(0.35);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(strength('2026-03-15')).toBeGreaterThan(0);
  expect(strength('2026-03-08')).toBe(0.35);
  expect(todayLeft()).toBe(initialLeft + 40);
  // Local calendar midnights can be 23 or 25 hours apart across DST.
  await vi.advanceTimersByTimeAsync(
    new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime()
  );
  expect(todayLeft()).toBe(initialLeft + 80);
  expect(vi.getTimerCount()).toBe(1);
  const previous = strength('2026-03-15');
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('hidden');
  vi.setSystemTime(new Date(2026, 2, 12, 12));
  fireEvent(document, new Event('visibilitychange'));
  expect(strength('2026-03-15')).toBe(previous);
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(strength('2026-03-15')).toBeGreaterThan(previous);
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  fireEvent.focus(window);
  fireEvent(document, new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(0);
});
