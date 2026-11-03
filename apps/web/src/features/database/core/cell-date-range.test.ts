import {
  dateTimeRangeValue,
  timeRangeFromValue,
} from '@app/components/date-time-range/time-range';
import { afterEach, describe, expect, it } from 'vitest';
import { cellTimeRange, toCellTimeRange } from './cell-date-range';

const systemTimeZone = process.env.TZ;
afterEach(() => {
  process.env.TZ = systemTimeZone;
});

describe('time-range cells', () => {
  it('reads whole stored days as an all-day range of local days', () => {
    expect(
      cellTimeRange('2026-10-09T00:00:00.000Z/2026-10-13T00:00:00.000Z')
    ).toEqual({
      allDay: true,
      start: new Date(2026, 9, 9),
      end: new Date(2026, 9, 13),
    });
    expect(cellTimeRange('2026-10-09T00:00:00Z/2026-10-13T00:00:00Z')).toEqual({
      allDay: true,
      start: new Date(2026, 9, 9),
      end: new Date(2026, 9, 13),
    });
  });

  it('reads any other instants as a timed range', () => {
    expect(
      cellTimeRange('2026-10-09T13:00:00.000Z/2026-10-13T21:30:00.000Z')
    ).toEqual({
      allDay: false,
      start: new Date('2026-10-09T13:00:00.000Z'),
      end: new Date('2026-10-13T21:30:00.000Z'),
    });
  });

  it('reads nothing from an empty, malformed or backwards cell', () => {
    expect(cellTimeRange(null)).toBeUndefined();
    expect(cellTimeRange('2026-10-09T00:00:00.000Z')).toBeUndefined();
    expect(
      cellTimeRange('2026-10-13T00:00:00.000Z/2026-10-09T00:00:00.000Z')
    ).toBeUndefined();
    expect(
      cellTimeRange('2026-10-13T09:00:00.000Z/2026-10-13T08:00:00.000Z')
    ).toBeUndefined();
  });

  it('stores all-day ranges as UTC midnights and timed ranges as instants', () => {
    expect(
      toCellTimeRange({
        allDay: true,
        start: new Date(2026, 9, 9),
        end: new Date(2026, 9, 13),
      })
    ).toBe('2026-10-09T00:00:00.000Z/2026-10-13T00:00:00.000Z');
    expect(
      toCellTimeRange({
        allDay: false,
        start: new Date('2026-10-09T13:00:00.000Z'),
        end: new Date('2026-10-13T21:30:00.000Z'),
      })
    ).toBe('2026-10-09T13:00:00.000Z/2026-10-13T21:30:00.000Z');
  });

  describe('through the range fields', () => {
    it('edits stored days as the same calendar days west of UTC', () => {
      process.env.TZ = 'America/Los_Angeles';
      const range = cellTimeRange(
        '2026-03-07T00:00:00.000Z/2026-03-09T00:00:00.000Z'
      );
      const fields = range && dateTimeRangeValue(range);
      expect(fields).toEqual({
        allDay: true,
        start: '2026-03-07',
        end: '2026-03-09',
      });
      const edited =
        fields && timeRangeFromValue({ ...fields, end: '2026-03-10' });
      expect(edited && toCellTimeRange(edited)).toBe(
        '2026-03-07T00:00:00.000Z/2026-03-10T00:00:00.000Z'
      );
    });

    it('edits stored instants as local times across a DST change', () => {
      process.env.TZ = 'America/New_York';
      const range = cellTimeRange(
        '2026-03-08T06:00:00.000Z/2026-03-08T08:00:00.000Z'
      );
      const fields = range && dateTimeRangeValue(range);
      expect(fields).toEqual({
        allDay: false,
        start: '2026-03-08T01:00',
        end: '2026-03-08T04:00',
      });
      const edited =
        fields && timeRangeFromValue({ ...fields, end: '2026-03-08T05:15' });
      expect(edited && toCellTimeRange(edited)).toBe(
        '2026-03-08T06:00:00.000Z/2026-03-08T09:15:00.000Z'
      );
    });
  });
});
