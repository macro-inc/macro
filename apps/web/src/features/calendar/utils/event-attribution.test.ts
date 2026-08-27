import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../types';
import { eventAttribution } from './event-attribution';

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: '["event","occurrence"]',
    eventId: 'event',
    occurrenceKey: 'occurrence',
    isCancelled: false,
    isReadOnly: false,
    attendees: [],
    recurrenceLines: [],
    title: 'd',
    start: '2026-08-27T19:00:00.000Z',
    end: '2026-08-27T20:45:00.000Z',
    allDay: false,
    calendar: {
      id: 'jackson-cal',
      name: 'Jackson Kustec',
      color: 'orange',
      emailAddress: 'jackson@example.com',
      isPrimary: true,
    },
    ...overrides,
  };
}

describe('eventAttribution', () => {
  it('shows the calendar and creator when the organizer is the calendar owner', () => {
    const attribution = eventAttribution(
      event({
        organizerName: 'Jackson Kustec',
        organizerEmail: 'jackson@example.com',
        creatorName: 'Teo Nys',
        creatorEmail: 'teo@example.com',
      })
    );

    expect(attribution.calendarName).toBe('Jackson Kustec');
    expect(attribution.creator).toEqual({
      displayName: 'Teo Nys',
      email: 'teo@example.com',
      isSelf: false,
    });
    expect(attribution.organizer).toBeUndefined();
  });

  it('does not label the calendar owner as organizer when creator is unknown', () => {
    const attribution = eventAttribution(
      event({
        organizerName: 'Jackson Kustec',
        organizerEmail: 'jackson@example.com',
      })
    );

    expect(attribution.calendarName).toBe('Jackson Kustec');
    expect(attribution.creator).toBeUndefined();
    expect(attribution.organizer).toBeUndefined();
  });

  it('shows a distinct meeting organizer on the viewer calendar', () => {
    const attribution = eventAttribution(
      event({
        calendar: {
          id: 'teo-cal',
          name: 'teo@example.com',
          color: 'blue',
          emailAddress: 'teo@example.com',
          isPrimary: true,
        },
        organizerName: 'Alex Organizer',
        organizerEmail: 'alex@example.com',
        creatorName: 'Alex Organizer',
        creatorEmail: 'alex@example.com',
      })
    );

    expect(attribution.calendarName).toBe('teo@example.com');
    expect(attribution.creator).toBeUndefined();
    expect(attribution.organizer).toEqual({
      displayName: 'Alex Organizer',
      email: 'alex@example.com',
      isSelf: false,
    });
  });

  it('hides creator and organizer on the writer’s own calendar', () => {
    const attribution = eventAttribution(
      event({
        calendar: {
          id: 'teo-cal',
          name: 'teo@example.com',
          color: 'blue',
          emailAddress: 'teo@example.com',
          isPrimary: true,
        },
        organizerName: 'Teo Nys',
        organizerEmail: 'teo@example.com',
        creatorName: 'Teo Nys',
        creatorEmail: 'teo@example.com',
      })
    );

    expect(attribution.calendarName).toBe('teo@example.com');
    expect(attribution.creator).toBeUndefined();
    expect(attribution.organizer).toBeUndefined();
  });

  it('does not treat the viewer inbox as the calendar on a shared calendar', () => {
    const attribution = eventAttribution(
      event({
        calendar: {
          id: 'jackson-cal',
          name: 'Jackson Kustec',
          color: 'orange',
          emailAddress: 'teo@example.com',
          isPrimary: false,
        },
        organizerName: 'Jackson Kustec',
        organizerEmail: 'jackson@example.com',
        creatorName: 'Teo Nys',
        creatorEmail: 'teo@example.com',
      })
    );

    expect(attribution.calendarName).toBe('Jackson Kustec');
    expect(attribution.creator).toEqual({
      displayName: 'Teo Nys',
      email: 'teo@example.com',
      isSelf: false,
    });
    expect(attribution.organizer).toBeUndefined();
  });

  it('matches a multi-inbox calendar label to the calendar owner, not the inbox', () => {
    const attribution = eventAttribution(
      event({
        calendar: {
          id: 'jackson-cal',
          name: 'Jackson Kustec — teo@example.com',
          color: 'orange',
          emailAddress: 'teo@example.com',
          isPrimary: false,
        },
        organizerName: 'Jackson Kustec',
        organizerEmail: 'jackson@example.com',
        creatorName: 'Teo Nys',
        creatorEmail: 'teo@example.com',
      })
    );

    expect(attribution.calendarName).toBe('Jackson Kustec — teo@example.com');
    expect(attribution.creator?.displayName).toBe('Teo Nys');
    expect(attribution.organizer).toBeUndefined();
  });
});
