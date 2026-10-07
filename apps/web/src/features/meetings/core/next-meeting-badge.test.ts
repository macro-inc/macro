import { describe, expect, it } from 'vitest';
import { nextMeetingBadge } from './next-meeting-badge';
import type { UpcomingCalendarEvent } from './upcoming-calendar-events';

const NOW = new Date('2026-10-07T15:00:00Z');

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
        [event('2026-10-07T14:30:00Z', '2026-10-07T15:30:00Z')],
        NOW
      )
    ).toEqual({ kind: 'now', label: 'Now' });
  });

  it('shows Now at the start instant and not at the end instant', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07T15:00:00Z', '2026-10-07T15:30:00Z')],
        NOW
      )?.kind
    ).toBe('now');
    expect(
      nextMeetingBadge(
        [event('2026-10-07T14:30:00Z', '2026-10-07T15:00:00Z')],
        NOW
      )
    ).toBeUndefined();
  });

  it('counts minutes to the next meeting inside the hour', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07T15:12:00Z', '2026-10-07T15:42:00Z')],
        NOW
      )
    ).toEqual({ kind: 'soon', label: '12m', minutes: 12 });
  });

  it('rounds a partial minute up so the badge never reads 0m', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07T15:00:20Z', '2026-10-07T15:30:00Z')],
        NOW
      )
    ).toMatchObject({ kind: 'soon', label: '1m' });
  });

  it('stays hidden at an hour or more', () => {
    expect(
      nextMeetingBadge(
        [event('2026-10-07T16:00:00Z', '2026-10-07T16:30:00Z')],
        NOW
      )
    ).toBeUndefined();
    expect(
      nextMeetingBadge(
        [event('2026-10-07T15:59:00Z', '2026-10-07T16:30:00Z')],
        NOW
      )
    ).toMatchObject({ label: '59m' });
  });

  it('picks the soonest upcoming meeting regardless of order', () => {
    expect(
      nextMeetingBadge(
        [
          event('2026-10-07T15:40:00Z', '2026-10-07T16:00:00Z'),
          event('2026-10-07T15:20:00Z', '2026-10-07T15:30:00Z'),
        ],
        NOW
      )
    ).toMatchObject({ label: '20m' });
  });

  it('prefers Now over an upcoming meeting', () => {
    expect(
      nextMeetingBadge(
        [
          event('2026-10-07T15:10:00Z', '2026-10-07T15:30:00Z'),
          event('2026-10-07T14:50:00Z', '2026-10-07T15:20:00Z'),
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

  it('ignores events with unparseable or inverted times', () => {
    expect(
      nextMeetingBadge(
        [
          event('nope', '2026-10-07T15:30:00Z'),
          event('2026-10-07T15:20:00Z', '2026-10-07T15:10:00Z'),
        ],
        NOW
      )
    ).toBeUndefined();
  });
});
