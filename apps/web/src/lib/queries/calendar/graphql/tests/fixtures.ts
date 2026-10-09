import type {
  CalendarEventFieldsFragment,
  CalendarOccurrenceItemFieldsFragment,
} from '@service-storage/graphql/generated/graphql';

export const attendee = (
  email: string,
  responseStatus: 'ACCEPTED' | 'NEEDS_ACTION' | 'DECLINED' | 'TENTATIVE'
) => ({
  email,
  displayName: null,
  responseStatus,
  isOrganizer: false,
  isOptional: false,
  isSelf: email === 'me@example.com',
  comment: null,
});

export const reminders = {
  useDefault: false,
  overrides: [{ method: 'popup', minutes: 10 }],
};

export function graphqlEvent(
  overrides: Partial<CalendarEventFieldsFragment> = {}
): CalendarEventFieldsFragment {
  return {
    __typename: 'GraphqlCalendarEvent',
    id: 'event-1',
    ownerId: 'user-1',
    linkId: 'link-1',
    icalUid: 'uid-1',
    calendarId: 'calendar-1',
    sources: [
      {
        calendarId: 'calendar-1',
        title: 'Standup',
        description: 'Daily',
        location: 'Room 1',
        eventType: 'DEFAULT',
        visibility: 'DEFAULT',
        transparency: 'OPAQUE',
        isReadOnly: false,
        reminders,
        creatorEmail: null,
        creatorName: null,
      },
      {
        calendarId: 'calendar-2',
        title: 'Team standup',
        description: null,
        location: null,
        eventType: 'DEFAULT',
        visibility: 'PRIVATE',
        transparency: 'TRANSPARENT',
        isReadOnly: true,
        reminders,
        creatorEmail: null,
        creatorName: null,
      },
    ],
    title: 'Standup',
    description: 'Daily',
    location: 'Room 1',
    status: 'CONFIRMED',
    visibility: 'DEFAULT',
    transparency: 'OPAQUE',
    eventType: 'OUT_OF_OFFICE',
    time: {
      __typename: 'GraphqlTimedEventTime',
      startsAt: '2026-10-05T09:00:00+00:00',
      endsAt: '2026-10-05T09:30:00+00:00',
      timeZone: 'America/New_York',
    },
    recurrenceLines: ['RRULE:FREQ=DAILY'],
    organizerEmail: 'boss@example.com',
    organizerName: 'Boss',
    creatorEmail: null,
    creatorName: null,
    conferenceUrl: 'https://meet.example.com/x',
    conferenceProvider: 'GOOGLE_MEET',
    sequence: 3,
    isReadOnly: false,
    attendees: [attendee('me@example.com', 'NEEDS_ACTION')],
    reminders,
    createdAt: '2026-09-01T12:00:00+00:00',
    updatedAt: '2026-09-02T12:00:00.250+00:00',
    ...overrides,
  };
}

export function graphqlOccurrence(
  overrides: Partial<CalendarOccurrenceItemFieldsFragment> = {}
): CalendarOccurrenceItemFieldsFragment {
  return {
    __typename: 'GraphqlCalendarOccurrence',
    id: 'event-1:2026-10-06T09:00:00+00:00',
    eventId: 'event-1',
    linkId: 'link-1',
    occurrenceKey: '2026-10-06T09:00:00+00:00',
    recurrenceId: null,
    isCancelled: false,
    time: {
      __typename: 'GraphqlTimedEventTime',
      startsAt: '2026-10-06T09:00:00+00:00',
      endsAt: '2026-10-06T09:30:00+00:00',
      timeZone: null,
    },
    overrideTitle: null,
    overrideDescription: null,
    overrideLocation: null,
    overrideStatus: null,
    overrideAttendees: null,
    event: graphqlEvent(),
    ...overrides,
  };
}
