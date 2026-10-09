import { describe, expect, it } from 'vitest';
import { nextMeetingBadge } from './next-meeting-badge';
import type { UpcomingCalendarEvent } from './upcoming-calendar-events';

// Keep same-day fixtures on one local date in every test runner timezone.
const NOW = new Date('2026-10-07T15:00:00');

const event = (
  start: string,
  end: string,
  overrides: Partial<UpcomingCalendarEvent> = {}
): UpcomingCalendarEvent => ({
  id: `${start}-${end}`,
  title: 'Standup',
  color: '#000',
  start,
  end,
  allDay: false,
  eventId: `${start}-${end}`,
  occurrenceKey: '',
  ...overrides,
});

describe('nextMeetingBadge', () => {
  it('shows nothing without events', () => {
    expect(nextMeetingBadge([], NOW)).toBeUndefined();
  });

  it('shows Now while a meeting is in progress', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07T14:30:00', '2026-10-07T15:30:00')],
        NOW
      )
    ).toEqual({ kind: 'now', label: 'Now' });
  });

  it('shows Now at the start instant and not at the end instant', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07T15:00:00', '2026-10-07T15:30:00')],
        NOW
      )?.kind
    ).toBe('now');
    expect(
      nextMeetingBadge(
        [event('2026-10-07T14:30:00', '2026-10-07T15:00:00')],
        NOW
      )
    ).toBeUndefined();
  });

  it('counts minutes to the next meeting inside the hour', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07T15:12:00', '2026-10-07T15:42:00')],
        NOW
      )
    ).toEqual({ kind: 'soon', label: '12m', minutes: 12 });
  });

  it('counts down to a point without showing it as ongoing', () => {
    const point = event('2026-10-07T15:12:00', '2026-10-07T15:12:00');
    expect(nextMeetingBadge([point], NOW)).toEqual({
      kind: 'soon',
      label: '12m',
      minutes: 12,
    });
    expect(nextMeetingBadge([point], new Date(point.start))).toBeUndefined();
  });

  it('rounds a partial minute up so the badge never reads 0m', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07T15:00:20', '2026-10-07T15:30:00')],
        NOW
      )
    ).toMatchObject({ kind: 'soon', label: '1m' });
  });

  it('stays hidden at an hour or more', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07T16:00:00', '2026-10-07T16:30:00')],
        NOW
      )
    ).toBeUndefined();
    expect(
      nextMeetingBadge(
        [event('2026-10-07T15:59:00', '2026-10-07T16:30:00')],
        NOW
      )
    ).toMatchObject({ label: '59m' });
  });

  it('picks the soonest upcoming meeting regardless of order', () => {
    expect(
      nextMeetingBadge(
        [
          event('2026-10-07T15:40:00', '2026-10-07T16:00:00'),
          event('2026-10-07T15:20:00', '2026-10-07T15:30:00'),
        ],
        NOW
      )
    ).toMatchObject({ label: '20m' });
  });

  it('prefers Now over an upcoming meeting', () => {
    expect(
      nextMeetingBadge(
        [
          event('2026-10-07T15:10:00', '2026-10-07T15:30:00'),
          event('2026-10-07T14:50:00', '2026-10-07T15:20:00'),
        ],
        NOW
      )?.kind
    ).toBe('now');
  });

  it('ignores all-day events', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07', '2026-10-08', { allDay: true })],
        NOW
      )
    ).toBeUndefined();
  });

  it('ignores ongoing timed spans displayed in the all-day row', () => {
    const now = new Date(2026, 9, 7, 15);
    const trip = event(
      new Date(2026, 9, 6, 9).toISOString(),
      new Date(2026, 9, 9, 17).toISOString()
    );
    expect(nextMeetingBadge([trip], now)).toBeUndefined();
    expect(
      nextMeetingBadge(
        [
          trip,
          event(
            new Date(2026, 9, 7, 15, 12).toISOString(),
            new Date(2026, 9, 7, 15, 42).toISOString()
          ),
        ],
        now
      )
    ).toEqual({ kind: 'soon', label: '12m', minutes: 12 });
  });

  it('does not count down to a timed span displayed in the all-day row', () => {
    expect(
      nextMeetingBadge(
        [
          event(
            new Date(2026, 9, 7, 15, 5).toISOString(),
            new Date(2026, 9, 9, 17).toISOString()
          ),
        ],
        new Date(2026, 9, 7, 15)
      )
    ).toBeUndefined();
  });

  it('keeps a same-day meeting ending exactly at local midnight', () => {
    const meeting = event(
      new Date(2026, 9, 7, 23, 30).toISOString(),
      new Date(2026, 9, 8).toISOString()
    );
    expect(nextMeetingBadge([meeting], new Date(2026, 9, 7, 23, 20))).toEqual({
      kind: 'soon',
      label: '10m',
      minutes: 10,
    });
    expect(nextMeetingBadge([meeting], new Date(2026, 9, 7, 23, 30))).toEqual({
      kind: 'now',
      label: 'Now',
    });
    expect(nextMeetingBadge([meeting], new Date(2026, 9, 8))).toBeUndefined();
  });

  it('ignores events with unparseable or inverted times', () => {
    expect(
      nextMeetingBadge(
        [
          event('nope', '2026-10-07T15:30:00'),
          event('2026-10-07T15:20:00', '2026-10-07T15:10:00'),
        ],
        NOW
      )
    ).toBeUndefined();
  });
});
