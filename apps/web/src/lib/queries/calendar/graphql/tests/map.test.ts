import { describe, expect, it } from 'vitest';
import {
  mapCalendarEvent,
  mapCalendarOccurrence,
  mapVisibleCalendar,
} from '../map';
import { attendee, graphqlEvent, graphqlOccurrence } from './fixtures';

describe('mapCalendarEvent', () => {
  it('maps the series event to the REST shape', () => {
    const event = mapCalendarEvent(graphqlEvent());
    expect(event).toMatchObject({
      id: 'event-1',
      ownerId: 'user-1',
      icalUid: 'uid-1',
      calendarId: 'calendar-1',
      status: 'confirmed',
      visibility: 'default',
      transparency: 'opaque',
      eventType: 'out_of_office',
      conferenceProvider: 'google_meet',
      time: {
        kind: 'timed',
        startsAt: '2026-10-05T09:00:00Z',
        endsAt: '2026-10-05T09:30:00Z',
        timeZone: 'America/New_York',
      },
      attendees: [
        {
          email: 'me@example.com',
          responseStatus: 'needs_action',
          isSelf: true,
        },
      ],
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 10 }],
      },
      createdAt: '2026-09-01T12:00:00Z',
      updatedAt: '2026-09-02T12:00:00.250Z',
    });
    expect(event.sources?.[1]).toMatchObject({
      calendarId: 'calendar-2',
      visibility: 'private',
      transparency: 'transparent',
      isReadOnly: true,
    });
  });

  it('keeps an absent conference provider and maps all-day spans', () => {
    const event = mapCalendarEvent(
      graphqlEvent({
        conferenceProvider: null,
        time: {
          __typename: 'GraphqlAllDayEventTime',
          startDate: '2026-10-05',
          endDate: '2026-10-06',
        },
      })
    );
    expect(event.conferenceProvider).toBeNull();
    expect(event.time).toEqual({
      kind: 'allDay',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
    });
  });
});

describe('mapCalendarOccurrence', () => {
  it('returns the series event unchanged without an exception', () => {
    const item = mapCalendarOccurrence(graphqlOccurrence());
    expect(item.occurrence).toEqual({
      eventId: 'event-1',
      occurrenceKey: '2026-10-06T09:00:00+00:00',
      recurrenceId: null,
      isCancelled: false,
      time: {
        kind: 'timed',
        startsAt: '2026-10-06T09:00:00Z',
        endsAt: '2026-10-06T09:30:00Z',
        timeZone: null,
      },
    });
    expect(item.event).toEqual(mapCalendarEvent(graphqlEvent()));
  });

  it('applies the occurrence exception to the event and every copy', () => {
    const item = mapCalendarOccurrence(
      graphqlOccurrence({
        overrideTitle: 'Moved standup',
        overrideDescription: 'Only today',
        overrideLocation: 'Room 2',
        overrideStatus: 'TENTATIVE',
        overrideAttendees: [attendee('me@example.com', 'ACCEPTED')],
      })
    );
    expect(item.event).toMatchObject({
      title: 'Moved standup',
      description: 'Only today',
      location: 'Room 2',
      status: 'tentative',
      attendees: [{ email: 'me@example.com', responseStatus: 'accepted' }],
    });
    expect(
      item.event.sources?.map(({ title, description, location }) => ({
        title,
        description,
        location,
      }))
    ).toEqual([
      { title: 'Moved standup', description: 'Only today', location: 'Room 2' },
      { title: 'Moved standup', description: 'Only today', location: 'Room 2' },
    ]);
  });

  it('applies only the fields an exception overrides', () => {
    const item = mapCalendarOccurrence(
      graphqlOccurrence({ overrideLocation: 'Room 9' })
    );
    expect(item.event.title).toBe('Standup');
    expect(item.event.status).toBe('confirmed');
    expect(item.event.sources?.map((source) => source.title)).toEqual([
      'Standup',
      'Team standup',
    ]);
    expect(item.event.sources?.map((source) => source.location)).toEqual([
      'Room 9',
      'Room 9',
    ]);
    expect(item.event.attendees[0]?.responseStatus).toBe('needs_action');
  });
});

describe('mapVisibleCalendar', () => {
  it('maps the link id to the REST field name', () => {
    expect(
      mapVisibleCalendar({
        __typename: 'GraphqlCalendar',
        id: 'calendar-1',
        linkId: 'link-1',
        emailAddress: 'me@example.com',
        name: 'Me',
        color: '#ff0000',
        isPrimary: true,
        isWritable: true,
        isSubscription: false,
        syncError: null,
        defaultReminders: [{ method: 'popup', minutes: 30 }],
      })
    ).toEqual({
      id: 'calendar-1',
      emailLinkId: 'link-1',
      emailAddress: 'me@example.com',
      name: 'Me',
      color: '#ff0000',
      isPrimary: true,
      isWritable: true,
      isSubscription: false,
      syncError: null,
      defaultReminders: [{ method: 'popup', minutes: 30 }],
    });
  });
});
