import { expect, it } from 'vitest';
import {
  extendGanttRange,
  ganttCreationRange,
  ganttResizePreview,
  resizedGanttEnd,
  snapGanttGuide,
} from './gantt-interaction';

it('snaps to the nearest visible start or inclusive end boundary, without inventing undated ends', () => {
  const targets = [{ start: 10, end: 12 }, { start: 20 }];
  expect(snapGanttGuide(12.8, 20, targets)).toEqual({ day: 13, edge: 'end' });
  expect(resizedGanttEnd(10, snapGanttGuide(12.8, 20, targets).day)).toBe(12);
  expect(snapGanttGuide(19.8, 20, targets)).toEqual({ day: 20, edge: 'start' });
  expect(snapGanttGuide(21, 20, targets)).toEqual({ day: 21 });
  expect(snapGanttGuide(12.5, 20, targets)).toEqual({ day: 12.5 });
  expect(resizedGanttEnd(10, 9)).toBe(10);
});

it('keeps the drawn edge continuous without allowing the end before its start', () => {
  expect(ganttResizePreview(10, 13.2)).toEqual({ boundary: 13.2, end: 12 });
  expect(ganttResizePreview(10, 13.25)).toEqual({ boundary: 13.25, end: 12 });
  expect(ganttResizePreview(10, 9.2)).toEqual({ boundary: 11, end: 10 });
  expect(ganttResizePreview(10, 13.6)).toEqual({ boundary: 13.6, end: 13 });
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
