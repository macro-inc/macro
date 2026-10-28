import { expect, it } from 'vitest';
import {
  extendGanttRange,
  ganttCreationRange,
  ganttDragAxis,
  rescheduledGanttDays,
  snapGanttGuide,
} from './gantt-interaction';

it('snaps to the nearest visible start or inclusive end boundary, without inventing undated ends', () => {
  const targets = [{ start: 10, end: 12 }, { start: 20 }];
  expect(snapGanttGuide(12.8, 20, targets)).toEqual({ day: 13, edge: 'end' });
  expect(snapGanttGuide(19.8, 20, targets)).toEqual({ day: 20, edge: 'start' });
  expect(snapGanttGuide(21, 20, targets)).toEqual({ day: 21 });
  expect(snapGanttGuide(12.5, 20, targets)).toEqual({ day: 12.5 });
});

it('creates inclusive calendar-date selections in either drag direction', () => {
  expect(ganttCreationRange(10.2, 15.9)).toEqual({ start: 10, end: 16 });
  expect(ganttCreationRange(15.9, 10.2)).toEqual({ start: 10, end: 16 });
  expect(ganttCreationRange(10.2, 10.8)).toEqual({ start: 10, end: 11 });
});

it('extends only approached calendar edges, including viewports wider than their initial range', () => {
  const range = { start: 10, end: 110 };
  expect(extendGanttRange(range, 400, 1000, 3000, 20)).toBeUndefined();
  expect(extendGanttRange(range, 10, 1000, 3000, 20)).toEqual({
    start: -40,
    end: 110,
  });
  expect(extendGanttRange(range, 1990, 1000, 3000, 20)).toEqual({
    start: 10,
    end: 160,
  });
  expect(extendGanttRange(range, 0, 1000, 1000, 20)).toEqual({
    start: -40,
    end: 160,
  });
});

it('reschedules a bar by moving it whole or dragging one inclusive edge, never past the other', () => {
  expect(rescheduledGanttDays({ start: 10, end: 14 }, 'move', 3)).toEqual({
    start: 13,
    end: 17,
  });
  expect(rescheduledGanttDays({ start: 10, end: 14 }, 'move', -12)).toEqual({
    start: -2,
    end: 2,
  });
  expect(rescheduledGanttDays({ start: 10, end: 14 }, 'start', -2)).toEqual({
    start: 8,
    end: 14,
  });
  expect(rescheduledGanttDays({ start: 10, end: 14 }, 'start', 9)).toEqual({
    start: 14,
    end: 14,
  });
  expect(rescheduledGanttDays({ start: 10, end: 14 }, 'end', 2)).toEqual({
    start: 10,
    end: 16,
  });
  expect(rescheduledGanttDays({ start: 10, end: 14 }, 'end', -9)).toEqual({
    start: 10,
    end: 10,
  });
});

it('tells a vertical drag from a horizontal one once the press has moved far enough', () => {
  expect(ganttDragAxis(2, 2, 4)).toBeUndefined();
  expect(ganttDragAxis(1, 6, 4)).toBe('vertical');
  expect(ganttDragAxis(-3, -9, 4)).toBe('vertical');
  expect(ganttDragAxis(6, 1, 4)).toBe('horizontal');
  // A diagonal reschedules, as every drag did before.
  expect(ganttDragAxis(5, 5, 4)).toBe('horizontal');
});
