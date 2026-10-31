import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { GanttCreation } from './create-gantt-creation';
import { Gantt } from './gantt';
import { useGantt } from './gantt-context';
import { ganttDateFromDay, toGanttDay } from './gantt-date';
import type { GanttGroupMove } from './gantt-group-drag';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pointer = (
  target: Element | Window,
  type: string,
  x: number,
  y: number
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
};

/**
 * A 1000px chart at 20px a day after a 260px label column, so x 500 is day
 * 12 past `start`, with a bar or chip in group `a` and a row of group `b`
 * from y 250 to 290.
 */
function groupedFixture(options: {
  start: number;
  item: 'bar' | 'chip';
  onReschedule: (dates: GanttCreation) => Promise<unknown> | void;
  onMove: (move: GanttGroupMove) => Promise<void>;
}) {
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: { start: options.start, end: options.start + 100 },
      get children() {
        return createComponent(() => {
          const gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return [
            viewport,
            createComponent(Gantt.GroupDrag, {
              scope: 'test',
              canDrag: () => true,
              canDrop: () => true,
              onMove: options.onMove,
              get children() {
                return [
                  createComponent(Gantt.DragItem, {
                    id: 'launch',
                    key: 'launch',
                    groupId: 'a',
                    label: 'Launch',
                    get children() {
                      return options.item === 'bar'
                        ? createComponent(Gantt.Bar, {
                            start: ganttDateFromDay(options.start + 10),
                            end: ganttDateFromDay(options.start + 14),
                            title: 'Launch',
                            regroup: true,
                            onReschedule: options.onReschedule,
                          })
                        : createComponent(Gantt.UndatedChip, {
                            regroup: true,
                            onSchedule: options.onReschedule,
                            children: 'Launch',
                          });
                    },
                  }),
                  createComponent(Gantt.GroupDrop, { id: 'b', groupId: 'b' }),
                ];
              },
            }),
          ];
        }, {});
      },
    })
  );
  const drop = view.container.querySelector<HTMLElement>(
    '[data-gantt-group-drop="b"]'
  )!;
  drop.getBoundingClientRect = () => new DOMRect(0, 250, 1000, 40);
  const body = () =>
    view.container.querySelector<HTMLElement>('[data-gantt-bar-body]')!;
  return { ...view, body };
}

it('moves a bar dragged mostly down into the group under it, without rescheduling it', async () => {
  const onReschedule = vi.fn();
  const onMove = vi.fn(async () => {});
  const { body } = groupedFixture({
    start: 0,
    item: 'bar',
    onReschedule,
    onMove,
  });
  pointer(body(), 'pointerdown', 500, 200);
  pointer(window, 'pointermove', 503, 220);
  pointer(window, 'pointermove', 506, 260);
  pointer(window, 'pointerup', 506, 260);
  await waitFor(() =>
    expect(onMove).toHaveBeenCalledWith({
      id: 'launch',
      fromGroup: 'a',
      toGroup: 'b',
    })
  );
  expect(onReschedule).not.toHaveBeenCalled();
});

it('still reschedules a bar dragged mostly across', () => {
  const onReschedule = vi.fn();
  const onMove = vi.fn(async () => {});
  const { body } = groupedFixture({
    start: 0,
    item: 'bar',
    onReschedule,
    onMove,
  });
  pointer(body(), 'pointerdown', 500, 200);
  pointer(window, 'pointermove', 560, 205);
  pointer(window, 'pointerup', 560, 205);
  expect(onMove).not.toHaveBeenCalled();
  expect(onReschedule).toHaveBeenCalledOnce();
  expect(toGanttDay(onReschedule.mock.calls[0][0].start)).toBe(13);
});

it('gives an undated chip the day it is dropped on', () => {
  const today = toGanttDay(new Date())!;
  const onReschedule = vi.fn();
  const { body } = groupedFixture({
    start: today,
    item: 'chip',
    onReschedule,
    onMove: async () => {},
  });
  pointer(body(), 'pointerdown', 300, 200);
  pointer(window, 'pointermove', 360, 202);
  pointer(window, 'pointerup', 360, 202);
  expect(onReschedule).toHaveBeenCalledOnce();
  const dates = onReschedule.mock.calls[0][0];
  expect(toGanttDay(dates.start)).toBe(today + 3);
  expect(toGanttDay(dates.end)).toBe(today + 3);
  expect(dates.allDay).toBe(true);
});
