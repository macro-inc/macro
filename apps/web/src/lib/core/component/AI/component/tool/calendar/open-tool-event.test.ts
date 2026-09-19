import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openToolCalendarEvent,
  type ToolCalendarEvent,
  toolInputOpenTime,
} from './open-tool-event';

const openCalendarEventSplit = vi.hoisted(() => vi.fn());

vi.mock('@block-calendar/open-calendar-event', () => ({
  openCalendarEventSplit,
}));

const timedEvent: ToolCalendarEvent = {
  eventId: 'event-1',
  title: 'Standup',
  start: '2026-08-21T16:30:00+00:00',
  end: '2026-08-21T18:30:00+00:00',
  isAllDay: false,
  status: 'confirmed',
  isRecurring: false,
  recurrenceLines: [],
  attendees: [],
  attendeeCount: 0,
  isReadOnly: false,
};

describe('openToolCalendarEvent', () => {
  beforeEach(() => openCalendarEventSplit.mockClear());

  it('locates a timed event by its own span', () => {
    openToolCalendarEvent(timedEvent);

    expect(openCalendarEventSplit).toHaveBeenCalledWith({
      eventId: 'event-1',
      occurrenceKey: undefined,
      time: {
        kind: 'timed',
        startsAt: '2026-08-21T16:30:00+00:00',
        endsAt: '2026-08-21T18:30:00+00:00',
      },
    });
  });

  it('locates an all-day event by its dates', () => {
    openToolCalendarEvent({
      ...timedEvent,
      isAllDay: true,
      start: '2026-08-21',
      end: '2026-08-22',
    });

    expect(openCalendarEventSplit).toHaveBeenCalledWith({
      eventId: 'event-1',
      occurrenceKey: undefined,
      time: { kind: 'allDay', startDate: '2026-08-21', endDate: '2026-08-22' },
    });
  });

  // An occurrence-scoped call answers with the refreshed series, so the
  // series' own span would aim at the master rather than the instance.
  it('lets an occurrence key anchor the range on its own', () => {
    openToolCalendarEvent(timedEvent, {
      occurrenceKey: '2026-08-28T16:30:00+00:00',
    });

    expect(openCalendarEventSplit).toHaveBeenCalledWith({
      eventId: 'event-1',
      occurrenceKey: '2026-08-28T16:30:00+00:00',
      time: undefined,
    });
  });

  it('prefers supplied timing over the event span', () => {
    openToolCalendarEvent(timedEvent, {
      occurrenceKey: '2026-08-28T16:30:00+00:00',
      time: { kind: 'timed', startsAt: '2026-09-04T16:30:00Z' },
    });

    expect(openCalendarEventSplit).toHaveBeenCalledWith({
      eventId: 'event-1',
      occurrenceKey: '2026-08-28T16:30:00+00:00',
      time: { kind: 'timed', startsAt: '2026-09-04T16:30:00Z' },
    });
  });
});

describe('toolInputOpenTime', () => {
  it('carries a timed span across', () => {
    expect(
      toolInputOpenTime({
        kind: 'timed',
        startsAt: '2026-08-21T16:30:00Z',
        endsAt: '2026-08-21T18:30:00Z',
        timeZone: 'America/New_York',
      })
    ).toEqual({
      kind: 'timed',
      startsAt: '2026-08-21T16:30:00Z',
      endsAt: '2026-08-21T18:30:00Z',
    });
  });

  it('carries an all-day span across', () => {
    expect(
      toolInputOpenTime({
        kind: 'allDay',
        startDate: '2026-08-21',
        endDate: '2026-08-22',
      })
    ).toEqual({
      kind: 'allDay',
      startDate: '2026-08-21',
      endDate: '2026-08-22',
    });
  });
});
