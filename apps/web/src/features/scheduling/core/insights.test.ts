import { describe, expect, it } from 'vitest';
import {
  buildInsightPeriod,
  insightComparison,
  insightPresetRange,
  insightRangeError,
  insightsCsv,
  insightsQueryRange,
  previousInsightRange,
  reportDate,
} from './insights';
import type { Booking } from './types';

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    eventTypeId: 'event-1',
    title: 'Discovery call',
    name: 'Alex',
    email: 'alex@example.com',
    startsAt: '2026-09-18T13:00:00Z',
    endsAt: '2026-09-18T13:30:00Z',
    timeZone: 'America/New_York',
    hosts: ['host-1'],
    status: 'confirmed',
    attendance: 'unknown',
    rescheduleCount: 0,
    rescheduledAt: null,
    location: '',
    answers: {},
    ...overrides,
  };
}

const range = { from: '2026-09-18', to: '2026-09-18' };
const zone = 'America/New_York';
const now = new Date('2026-09-19T12:00:00Z');

describe('scheduling insights', () => {
  it('uses inclusive calendar dates in the report zone and filters failed requests', () => {
    const report = buildInsightPeriod(
      [
        booking({ id: 'before', startsAt: '2026-09-18T03:59:00Z' }),
        booking({ id: 'first', startsAt: '2026-09-18T04:00:00Z' }),
        booking({
          id: 'last',
          startsAt: '2026-09-19T03:59:00Z',
          endsAt: '2026-09-19T04:29:00Z',
        }),
        booking({ id: 'after', startsAt: '2026-09-19T04:00:00Z' }),
        booking({ id: 'failed', status: 'failed' }),
        booking({ id: 'processing', status: 'processing' }),
      ],
      range,
      zone,
      now
    );
    expect(report.bookings.map((b) => b.id)).toEqual(['first', 'last']);
    expect(report.counts.total).toBe(2);
    expect(report.days).toHaveLength(1);
    expect(report.days[0].date).toBe('2026-09-18');
    expect(report.hours[0]).toBe(1);
    expect(report.hours[23]).toBe(1);
  });

  it('counts reschedules and no-shows only from stored metadata', () => {
    const report = buildInsightPeriod(
      [
        booking(),
        booking({ id: 'rescheduled', rescheduleCount: 3 }),
        booking({ id: 'cancelled', status: 'cancelled', rescheduleCount: 1 }),
        booking({ id: 'pending', status: 'pending' }),
        booking({ id: 'guest-absent', attendance: 'guestNoShow' }),
        booking({ id: 'host-absent', attendance: 'hostNoShow' }),
      ],
      range,
      zone,
      now
    );
    expect(report.counts).toEqual({
      total: 6,
      completed: 2,
      rescheduled: 2,
      cancelled: 1,
      guestNoShow: 1,
      hostNoShow: 1,
    });
    expect(report.meetingMinutes).toBe(60);
    expect(report.averageMinutes).toBe(30);
    expect(report.eventCounts[0].count).toBe(6);
    expect(report.hostCounts).toEqual([{ id: 'host-1', count: 6 }]);
  });

  it('does not classify future or pending bookings as completed and deduplicates hosts', () => {
    const report = buildInsightPeriod(
      [
        booking({ hosts: ['host-1', 'host-1', 'host-2'] }),
        booking({ id: 'future', endsAt: '2026-09-20T13:30:00Z' }),
        booking({ id: 'pending', status: 'pending' }),
      ],
      range,
      zone,
      now
    );
    expect(report.counts.completed).toBe(1);
    expect(report.hostCounts).toEqual([
      { id: 'host-1', count: 3 },
      { id: 'host-2', count: 1 },
    ]);
  });

  it('builds equal-length previous periods across months and leap years', () => {
    expect(
      previousInsightRange({ from: '2024-03-01', to: '2024-03-07' })
    ).toEqual({ from: '2024-02-23', to: '2024-02-29' });
    expect(
      insightPresetRange(7, zone, new Date('2026-09-19T02:00:00Z'))
    ).toEqual({ from: '2026-09-12', to: '2026-09-18' });
    expect(reportDate(new Date('2026-09-19T02:00:00Z'), zone)).toBe(
      '2026-09-18'
    );
  });

  it('creates UTC query bounds at real local midnights through spring and fall DST', () => {
    expect(insightsQueryRange('2026-03-08', '2026-03-08', zone)).toEqual({
      from: '2026-03-07T05:00:00.000Z',
      to: '2026-03-09T04:00:00.000Z',
    });
    expect(insightsQueryRange('2026-11-01', '2026-11-01', zone)).toEqual({
      from: '2026-10-31T04:00:00.000Z',
      to: '2026-11-02T05:00:00.000Z',
    });
  });

  it('rejects invalid, reversed and excessive date ranges', () => {
    expect(
      insightRangeError({ from: '2026-02-30', to: '2026-03-01' })
    ).toBeDefined();
    expect(
      insightRangeError({ from: '2026-09-19', to: '2026-09-18' })
    ).toContain('End date');
    expect(
      insightRangeError({ from: '2025-01-01', to: '2026-12-31' })
    ).toContain('366');
    expect(
      insightRangeError({ from: '2024-01-01', to: '2024-12-31' })
    ).toBeUndefined();
  });

  it('does not claim an infinite growth rate from an empty preceding period', () => {
    expect(insightComparison(5, 0)).toBe('New');
    expect(insightComparison(0, 0)).toBe('0%');
    expect(insightComparison(0, 5)).toBe('-100%');
    expect(insightComparison(20, 5)).toBe('+300%');
  });

  it('exports actual records, escapes commas/quotes/newlines and neutralizes formulas', () => {
    const csv = insightsCsv(
      [
        booking({
          title: 'Intro, "hello"',
          name: '=HYPERLINK("bad")',
          location: 'private not included',
          hosts: ['host-1'],
          rescheduleCount: 2,
        }),
      ],
      new Map([['host-1', 'A\nB']])
    );
    expect(csv).toContain('"Intro, ""hello"""');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"A\nB"');
    expect(csv).toContain('"unknown","2"');
    expect(csv).not.toContain('private not included');
  });
});
