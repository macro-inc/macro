import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { Gantt } from './gantt';
import { type GanttContext, useGantt } from './gantt-context';
import type { GanttScale } from './gantt-date';
import { MAX_GANTT_PIXELS_PER_DAY } from './gantt-interaction';
import { MAX_GANTT_HOURS_PIXELS_PER_DAY } from './gantt-time';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * A chart from day 0 after a 260px label column. At hours zoom a day is
 * 1152px, 48px an hour, so 9 AM on day 0 is at x 692.
 */
function hoursFixture(options: { hours: boolean; scale: GanttScale }) {
  const onCreate = vi.fn();
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  let gantt!: GanttContext;
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 100 },
      hours: options.hours,
      defaultScale: options.scale,
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return [
            viewport,
            createComponent(Gantt.Header, {}),
            createComponent(Gantt.CreateArea, { onCreate }),
          ];
        }, {});
      },
    })
  );
  const pointer = (target: Element | Window, type: string, x: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: 200,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(target, event);
  };
  return { ...view, viewport, gantt, pointer, onCreate };
}

it('draws a timed range in quarter hours at hours zoom', () => {
  const { viewport, pointer, onCreate, getByText } = hoursFixture({
    hours: true,
    scale: 'hour',
  });
  pointer(viewport, 'pointerdown', 932);
  // From 2 PM back to 9:04 AM, which snaps to 9 AM.
  pointer(window, 'pointermove', 695);
  expect(getByText('Jan 1, 1970, 9 AM – 2 PM')).toBeTruthy();
  pointer(window, 'pointerup', 695);
  expect(onCreate).toHaveBeenCalledWith({
    start: new Date(1970, 0, 1, 9),
    end: new Date(1970, 0, 1, 14),
    allDay: false,
  });
});

it('draws whole days below hours zoom, even on a chart showing hours', () => {
  const { viewport, pointer, onCreate } = hoursFixture({
    hours: true,
    scale: 'week',
  });
  pointer(viewport, 'pointerdown', 270);
  pointer(window, 'pointermove', 330);
  pointer(window, 'pointerup', 330);
  expect(onCreate).toHaveBeenCalledWith({
    start: new Date(1970, 0, 1),
    end: new Date(1970, 0, 4),
    allDay: true,
  });
});

it('zooms into hours only on a chart showing hours', () => {
  const shown = hoursFixture({ hours: true, scale: 'week' });
  shown.gantt.setScale('hour');
  expect(shown.gantt.scale()).toBe('hour');
  shown.gantt.zoomAt(500, -10_000);
  expect(shown.gantt.pixelsPerDay()).toBe(MAX_GANTT_HOURS_PIXELS_PER_DAY);
  cleanup();
  const days = hoursFixture({ hours: false, scale: 'week' });
  days.gantt.setScale('hour');
  expect(days.gantt.pixelsPerDay()).toBe(MAX_GANTT_PIXELS_PER_DAY);
  expect(days.gantt.scale()).toBe('day');
});

it('heads hours zoom with the day above its hour ticks and a now line with the time', () => {
  vi.useFakeTimers({ now: new Date(1970, 0, 1, 10, 30) });
  const { container, gantt } = hoursFixture({ hours: true, scale: 'week' });
  gantt.setScale('hour');
  expect(
    [...container.querySelectorAll('[data-gantt-day]')].map(
      (day) => day.textContent
    )
  ).toContain('Thu, Jan 1');
  expect(
    [...container.querySelectorAll('[data-gantt-hour-tick]')]
      .slice(0, 3)
      .map((tick) => tick.textContent)
  ).toEqual(['1 AM', '2 AM', '3 AM']);
  expect(container.querySelector('[data-gantt-now]')?.textContent).toBe(
    '10:30 AM'
  );
  gantt.setScale('week');
  expect(container.querySelector('[data-gantt-hour-tick]')).toBeNull();
  expect(container.querySelector('[data-gantt-now]')).toBeNull();
});
