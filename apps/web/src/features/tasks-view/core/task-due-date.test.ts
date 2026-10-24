import { describe, expect, it } from 'vitest';
import {
  compareTaskDueDates,
  createTaskCalendar,
  TASK_DUE_DATE_BUCKETS,
  taskDateOnlyToIso,
  taskDueDateBucket,
  taskDueDateBucketMatchesFilter,
  taskDueDatePickerBounds,
  taskDueDatePredicate,
  taskMatchesDueDate,
} from './task-due-date';

it('intersects deadline columns with whole-day filters without adding undated rows', () => {
  const calendar = createTaskCalendar(
    new Date('2026-10-21T18:00:00Z'),
    'America/New_York'
  );
  const range = taskDueDatePredicate(
    { type: 'range', start: '2026-10-22', end: '2026-10-28' },
    calendar
  );
  expect(
    TASK_DUE_DATE_BUCKETS.filter((bucket) =>
      taskDueDateBucketMatchesFilter(bucket.id, range, calendar)
    ).map((bucket) => bucket.id)
  ).toEqual(['tomorrow', 'next_7_days']);
  expect(
    TASK_DUE_DATE_BUCKETS.filter((bucket) =>
      taskDueDateBucketMatchesFilter(bucket.id, { hasDate: false }, calendar)
    ).map((bucket) => bucket.id)
  ).toEqual(['no_due_date']);
});

describe('task calendar deadlines', () => {
  it.each([
    [
      '2026-03-08T17:00:00Z',
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
    ],
    [
      '2026-11-01T17:00:00Z',
      '2026-11-01T04:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
    ],
  ])('uses calendar days across DST at %s', (now, today, tomorrow) => {
    const calendar = createTaskCalendar(new Date(now), 'America/New_York');
    expect(calendar.boundaries).toMatchObject({ today, tomorrow });
    const predicate = taskDueDatePredicate(
      { type: 'range', start: calendar.today, end: calendar.today },
      calendar
    );
    expect(predicate).toEqual({ dateRange: { start: today, end: tomorrow } });
    expect(taskDateOnlyToIso(calendar.today, calendar.timeZone)).toBe(today);
    expect(taskMatchesDueDate(today, predicate)).toBe(true);
    expect(taskMatchesDueDate(tomorrow, predicate)).toBe(false);
  });

  it('partitions every boundary without overlaps and does not mark today overdue', () => {
    const calendar = createTaskCalendar(
      new Date('2026-10-21T18:00:00Z'),
      'Asia/Kolkata'
    );
    const b = calendar.boundaries;
    expect(taskDueDateBucket('2026-10-20T18:29:59.999Z', calendar)).toBe(
      'overdue'
    );
    expect(taskDueDateBucket(b.today, calendar)).toBe('today');
    expect(taskDueDateBucket(b.tomorrow, calendar)).toBe('tomorrow');
    expect(taskDueDateBucket(b.day_two, calendar)).toBe('next_7_days');
    expect(taskDueDateBucket('2026-10-28T18:29:59.999Z', calendar)).toBe(
      'next_7_days'
    );
    expect(taskDueDateBucket(b.day_eight, calendar)).toBe('later');
    expect(taskDueDateBucket(undefined, calendar)).toBe('no_due_date');
    expect(taskDueDatePredicate({ type: 'overdue' }, calendar)).toEqual({
      dateRange: { end: b.today },
    });
    expect(taskDueDatePredicate({ type: 'later' }, calendar)).toEqual({
      dateRange: { start: b.day_eight },
    });
    expect(taskDueDatePickerBounds('next_7_days', calendar)).toEqual({
      min: '2026-10-23',
      max: '2026-10-28',
    });
    expect(taskMatchesDueDate(undefined, { hasDate: false })).toBe(true);
    expect(taskMatchesDueDate(undefined, { dateRange: { end: b.today } })).toBe(
      false
    );
  });

  it('keeps undated rows last and tied IDs ascending in both directions', () => {
    const rows = [
      { id: 'z' },
      { id: 'b', dueDate: '2026-10-21T00:00:00Z' },
      { id: 'c', dueDate: '2026-10-22T00:00:00Z' },
      { id: 'a', dueDate: '2026-10-21T00:00:00Z' },
      { id: 'y' },
    ];
    expect(
      [...rows].sort((a, b) => compareTaskDueDates(a, b)).map((row) => row.id)
    ).toEqual(['a', 'b', 'c', 'y', 'z']);
    expect(
      [...rows]
        .sort((a, b) => compareTaskDueDates(a, b, true))
        .map((row) => row.id)
    ).toEqual(['c', 'a', 'b', 'y', 'z']);
  });
});
