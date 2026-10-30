import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { GanttCreation } from './create-gantt-creation';
import { Gantt } from './gantt';
import { useGantt } from './gantt-context';
import { toGanttDay } from './gantt-date';

afterEach(() => {
  cleanup();
});

/** A 1000px chart from day 0 at 20px a day after a 260px label column, so x 500 is day 12. */
function barFixture(
  onReschedule?: (dates: GanttCreation) => Promise<unknown> | void
) {
  const onClick = vi.fn();
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 100 },
      get children() {
        return createComponent(() => {
          const gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return [
            viewport,
            createComponent(Gantt.Bar, {
              start: '1970-01-11',
              end: '1970-01-15',
              title: 'Launch',
              onClick,
              onReschedule,
            }),
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
  const bar = () =>
    view.container.querySelector<HTMLElement>('[data-gantt-bar]')!;
  const body = () =>
    view.container.querySelector<HTMLElement>('[data-gantt-bar-body]')!;
  const edge = (side: 'start' | 'end') =>
    view.container.querySelector<HTMLElement>(`[data-gantt-resize="${side}"]`);
  return { ...view, pointer, bar, body, edge, onClick };
}

it('moves a whole bar by the days it was dragged, without opening it', () => {
  const onReschedule = vi.fn();
  const { pointer, bar, body, onClick } = barFixture(onReschedule);
  expect(bar().dataset.ganttStart).toBe(String(toGanttDay('1970-01-11')));
  pointer(body(), 'pointerdown', 500);
  pointer(window, 'pointermove', 560);
  expect(bar().dataset.ganttStart).toBe('13');
  expect(bar().dataset.ganttEnd).toBe('17');
  pointer(window, 'pointerup', 560);
  expect(onReschedule).toHaveBeenCalledOnce();
  const dates = onReschedule.mock.calls[0][0];
  expect(toGanttDay(dates.start)).toBe(13);
  expect(toGanttDay(dates.end)).toBe(17);
  expect(dates.allDay).toBe(true);
  fireEvent.click(body().querySelector('button')!);
  expect(onClick).not.toHaveBeenCalled();
});

it('resizes one edge, never past the other', () => {
  const onReschedule = vi.fn();
  const { pointer, edge } = barFixture(onReschedule);
  pointer(edge('end')!, 'pointerdown', 560);
  pointer(window, 'pointermove', 600);
  pointer(window, 'pointerup', 600);
  pointer(edge('start')!, 'pointerdown', 460);
  pointer(window, 'pointermove', 900);
  pointer(window, 'pointerup', 900);
  expect(
    onReschedule.mock.calls.map(([dates]) => [
      toGanttDay(dates.start),
      toGanttDay(dates.end),
    ])
  ).toEqual([
    [10, 16],
    [14, 14],
  ]);
});

it('keeps the dragged days on screen until the write settles', async () => {
  let settle!: () => void;
  const written = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const { pointer, bar, body } = barFixture(() => written);
  pointer(body(), 'pointerdown', 500);
  pointer(window, 'pointermove', 540);
  pointer(window, 'pointerup', 540);
  expect(bar().dataset.ganttStart).toBe('12');
  settle();
  await waitFor(() => expect(bar().dataset.ganttStart).toBe('10'));
});

it('does nothing for a press without a drag, or Escape mid-drag', () => {
  const onReschedule = vi.fn();
  const { pointer, bar, body, onClick } = barFixture(onReschedule);
  pointer(body(), 'pointerdown', 500);
  pointer(window, 'pointerup', 501);
  fireEvent.click(body().querySelector('button')!);
  expect(onClick).toHaveBeenCalledOnce();
  pointer(body(), 'pointerdown', 500);
  pointer(window, 'pointermove', 600);
  fireEvent.keyDown(window, { key: 'Escape' });
  pointer(window, 'pointerup', 600);
  expect(bar().dataset.ganttStart).toBe('10');
  expect(onReschedule).not.toHaveBeenCalled();
});

it('stays display-only without a reschedule handler', () => {
  const { pointer, bar, body, edge, onClick } = barFixture();
  expect(edge('start')).toBeNull();
  pointer(body(), 'pointerdown', 500);
  pointer(window, 'pointermove', 600);
  pointer(window, 'pointerup', 600);
  expect(bar().dataset.ganttStart).toBe('10');
  fireEvent.click(body().querySelector('button')!);
  expect(onClick).toHaveBeenCalledOnce();
});

/**
 * A chart showing hours with a bar from 9 AM to 5 PM on day 0, after the
 * 260px label column. At hours zoom a day is 1152px, 48px an hour, so 9 AM is
 * at x 692; at week zoom a day is 20px.
 */
function timedFixture(
  scale: 'hour' | 'week',
  onReschedule: (dates: GanttCreation) => Promise<unknown> | void
) {
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 100 },
      hours: true,
      defaultScale: scale,
      get children() {
        return createComponent(() => {
          const gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return [
            viewport,
            createComponent(Gantt.Bar, {
              start: new Date(1970, 0, 1, 9),
              end: new Date(1970, 0, 1, 17),
              timed: true,
              title: 'Workshop',
              onReschedule,
            }),
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
  const body = () =>
    view.container.querySelector<HTMLElement>('[data-gantt-bar-body]')!;
  const edge = (side: 'start' | 'end') =>
    view.container.querySelector<HTMLElement>(`[data-gantt-resize="${side}"]`)!;
  return { ...view, pointer, body, edge };
}

it('moves a timed bar by quarter hours at hours zoom, showing both ends while dragging', () => {
  const onReschedule = vi.fn();
  const { pointer, body, getByText, getByRole } = timedFixture(
    'hour',
    onReschedule
  );
  expect(
    getByRole('button', { name: 'Workshop: Jan 1, 1970, 9 AM – 5 PM' })
  ).toBeTruthy();
  pointer(body(), 'pointerdown', 700);
  // Two hours and ten minutes later.
  pointer(window, 'pointermove', 804);
  expect(getByText('Thu, Jan 1, 11:15 AM → Thu, Jan 1, 7:15 PM')).toBeTruthy();
  pointer(window, 'pointerup', 804);
  expect(onReschedule).toHaveBeenCalledWith({
    start: new Date(1970, 0, 1, 11, 15),
    end: new Date(1970, 0, 1, 19, 15),
    allDay: false,
  });
});

it('resizes a timed bar to the quarter hour at hours zoom', () => {
  const onReschedule = vi.fn();
  const { pointer, edge } = timedFixture('hour', onReschedule);
  pointer(edge('start'), 'pointerdown', 692);
  // Back fifty minutes.
  pointer(window, 'pointermove', 652);
  pointer(window, 'pointerup', 652);
  expect(onReschedule).toHaveBeenCalledWith({
    start: new Date(1970, 0, 1, 8, 15),
    end: new Date(1970, 0, 1, 17),
    allDay: false,
  });
});

it('moves a timed bar by whole days at week zoom, keeping its times', () => {
  const onReschedule = vi.fn();
  const { pointer, body } = timedFixture('week', onReschedule);
  pointer(body(), 'pointerdown', 268);
  pointer(window, 'pointermove', 310);
  pointer(window, 'pointerup', 310);
  expect(onReschedule).toHaveBeenCalledWith({
    start: new Date(1970, 0, 3, 9),
    end: new Date(1970, 0, 3, 17),
    allDay: false,
  });
});
