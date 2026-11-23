import type { TaskEntityWithProperties } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { describe, expect, it } from 'vitest';
import {
  taskGanttDates,
  taskGanttTimed,
  taskGanttWholeDay,
} from './task-gantt';

const CREATED = '2026-11-10T09:12:00Z';

function task(dates: {
  start?: { value: string; has_time?: boolean };
  due?: { value: string; has_time?: boolean };
}): TaskEntityWithProperties {
  const property = (
    id: string,
    value: { value: string; has_time?: boolean }
  ) => ({
    definition: { id },
    value: { type: 'Date', ...value },
  });
  return {
    createdAt: CREATED,
    properties: [
      ...(dates.start
        ? [property(SYSTEM_PROPERTY_IDS.START_DATE, dates.start)]
        : []),
      ...(dates.due ? [property(SYSTEM_PROPERTY_IDS.DUE_DATE, dates.due)] : []),
    ],
  } as unknown as TaskEntityWithProperties;
}

describe('taskGanttDates', () => {
  it('starts a bar at the Start Date with start dates on', () => {
    const withStart = task({
      start: { value: '2026-11-23T05:00:00Z' },
      due: { value: '2026-11-27T05:00:00Z' },
    });
    expect(taskGanttDates(withStart, true)).toEqual({
      start: '2026-11-23T05:00:00Z',
      end: '2026-11-27T05:00:00Z',
    });
    expect(taskGanttDates(withStart).start).toBe(CREATED);
  });

  it('keeps the created date for a task without a start', () => {
    expect(
      taskGanttDates(task({ due: { value: '2026-11-27T05:00:00Z' } }), true)
    ).toEqual({ start: CREATED, end: '2026-11-27T05:00:00Z' });
  });
});

describe('taskGanttTimed and taskGanttWholeDay', () => {
  it('marks a bar timed when either end has a time, and names the end without one', () => {
    const mixed = task({
      start: { value: '2026-11-21T00:00:00Z' },
      due: { value: '2026-11-30T20:00:00Z', has_time: true },
    });
    expect(taskGanttTimed(mixed)).toBe(true);
    expect(taskGanttWholeDay(mixed)).toBe('start');

    const timed = task({
      start: { value: '2026-11-26T19:00:00Z', has_time: true },
      due: { value: '2026-11-26T21:00:00Z', has_time: true },
    });
    expect(taskGanttWholeDay(timed)).toBeUndefined();

    const wholeDays = task({
      start: { value: '2026-11-23T05:00:00Z' },
      due: { value: '2026-11-27T05:00:00Z' },
    });
    expect(taskGanttTimed(wholeDays)).toBe(false);
    expect(taskGanttWholeDay(wholeDays)).toBeUndefined();
  });
});
