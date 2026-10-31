import { describe, expect, test } from 'bun:test';
import type { CalendarEvent as CalendarEventRecord } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { CalendarNamespace } from './namespace';

function guest(email: string, isOrganizer: boolean) {
  return {
    email,
    responseStatus: 'accepted',
    isOrganizer,
    isOptional: false,
    isSelf: false,
  };
}

function copy(
  id: string,
  calendarId: string,
  self: { email: string; isOrganizer: boolean } | null,
  organize: boolean,
  others: ReturnType<typeof guest>[] = [],
): CalendarEventRecord {
  return {
    id,
    ownerId: 'macro|user@example.com',
    calendarId,
    icalUid: 'meeting@google.com',
    title: 'Planning',
    attendees: [
      ...(self
        ? [
            {
              email: self.email,
              responseStatus: 'needs_action',
              isOrganizer: self.isOrganizer,
              isOptional: false,
              isSelf: true,
            },
          ]
        : []),
      ...others,
    ],
    recurrenceLines: [],
    sequence: 0,
    status: 'confirmed',
    isReadOnly: false,
    time: {
      kind: 'timed',
      startsAt: '2026-01-01T09:00:00Z',
      endsAt: '2026-01-01T09:30:00Z',
    },
    transparency: 'opaque',
    visibility: 'default',
    guestPolicy: {
      canModify: false,
      canInviteOthers: true,
      canSeeOtherGuests: true,
    },
    isSnapshot: false,
    viewerCan: {
      editDetails: organize,
      inviteGuests: true,
      removeGuests: organize,
      setGuestPolicy: organize,
      rsvp: true,
      organize,
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as CalendarEventRecord;
}

const occurrence = {
  eventId: 'unused',
  occurrenceKey: '2026-01-01T09:00:00Z',
  time: {
    kind: 'timed',
    startsAt: '2026-01-01T09:00:00Z',
    endsAt: '2026-01-01T09:30:00Z',
  },
  isCancelled: false,
};

async function listed(
  events: CalendarEventRecord[],
  calendars: Record<string, unknown>[],
) {
  const client = {
    storage: {
      listOccurrences: async () => ({
        data: {
          items: events.map((event) => ({ event, occurrence })),
          nextCursor: null,
        },
      }),
    },
    calendar: { listCalendars: async () => ({ data: { calendars } }) },
  } as unknown as MacroClient;
  const items = [];
  for await (const item of new CalendarNamespace(client).occurrences({
    start: '2026-01-01T00:00:00Z',
    end: '2026-01-02T00:00:00Z',
  })) {
    items.push(item);
  }
  return items;
}

describe('calendar occurrences', () => {
  test('name the inbox and role of each copy of a meeting', async () => {
    let calendarReads = 0;
    const client = {
      storage: {
        listOccurrences: async () => ({
          data: {
            items: [
              {
                event: copy(
                  'organized',
                  'calendar-owner',
                  { email: 'owner@example.com', isOrganizer: true },
                  true,
                ),
                occurrence,
              },
              {
                event: copy(
                  'invited',
                  'calendar-guest',
                  { email: 'guest@example.com', isOrganizer: false },
                  false,
                ),
                occurrence,
              },
              {
                event: copy('shared', 'calendar-unknown', null, false),
                occurrence,
              },
            ],
            nextCursor: null,
          },
        }),
      },
      calendar: {
        listCalendars: async () => {
          calendarReads += 1;
          return {
            data: {
              calendars: [
                {
                  id: 'calendar-owner',
                  emailAddress: 'owner@example.com',
                  contributesToAvailability: true,
                },
                {
                  id: 'calendar-guest',
                  emailAddress: 'guest@example.com',
                  contributesToAvailability: true,
                },
              ],
            },
          };
        },
      },
    } as unknown as MacroClient;

    const items = [];
    for await (const item of new CalendarNamespace(client).occurrences({
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-02T00:00:00Z',
    })) {
      items.push(item);
    }

    expect(items.map((item) => [item.event.id, item.inbox, item.role])).toEqual(
      [
        ['organized', 'owner@example.com', 'organizer'],
        ['invited', 'guest@example.com', 'guest'],
        ['shared', undefined, undefined],
      ],
    );
    expect(calendarReads).toBe(1);
  });

  test('name the calendar and keep the inbox on a calendar someone else shared', async () => {
    const [mine, shared] = await listed(
      [
        copy('mine', 'calendar-own', null, true),
        copy('shared', 'calendar-colleague', null, true),
      ],
      [
        {
          id: 'calendar-own',
          name: 'user@example.com',
          emailAddress: 'user@example.com',
          contributesToAvailability: true,
        },
        {
          id: 'calendar-colleague',
          name: 'colleague@example.com',
          emailAddress: 'user@example.com',
          contributesToAvailability: false,
        },
      ],
    );

    expect(mine?.calendarName).toBe('user@example.com');
    expect(mine?.contributesToAvailability).toBe(true);
    expect(shared?.calendarName).toBe('colleague@example.com');
    expect(shared?.contributesToAvailability).toBe(false);
    expect(shared?.inbox).toBe('user@example.com');
  });

  test('never call the user the organizer of an event on someone else’s calendar', async () => {
    const calendars = [
      {
        id: 'calendar-own',
        emailAddress: 'user@example.com',
        contributesToAvailability: true,
      },
      {
        id: 'calendar-colleague',
        emailAddress: 'user@example.com',
        contributesToAvailability: false,
      },
    ];
    const self = { email: 'user@example.com', isOrganizer: false };
    const colleague = guest('colleague@example.com', true);

    const items = await listed(
      [
        copy('no-guests', 'calendar-colleague', null, true),
        copy('their-meeting', 'calendar-colleague', null, true, [colleague]),
        copy('invited-there', 'calendar-colleague', self, true, [colleague]),
        copy('invited-here', 'calendar-own', self, true, [colleague]),
      ],
      calendars,
    );

    expect(items.map((item) => [item.event.id, item.role])).toEqual([
      ['no-guests', undefined],
      ['their-meeting', undefined],
      ['invited-there', 'guest'],
      ['invited-here', 'guest'],
    ]);
  });

  test('count an event on the schedule when any copy is', async () => {
    const [item] = await listed(
      [
        {
          ...copy('both', 'calendar-primary', null, true),
          sources: [
            { calendarId: 'calendar-primary' },
            { calendarId: 'calendar-personal' },
          ],
        } as CalendarEventRecord,
      ],
      [
        {
          id: 'calendar-primary',
          name: 'user@example.com',
          emailAddress: 'user@example.com',
          contributesToAvailability: false,
        },
        {
          id: 'calendar-personal',
          name: 'Personal',
          emailAddress: 'user@example.com',
          contributesToAvailability: true,
        },
      ],
    );

    expect(item?.calendarName).toBe('user@example.com');
    expect(item?.contributesToAvailability).toBe(true);
    expect(item?.role).toBe('organizer');
  });

  test('keep the role of an event the user organizes on any calendar', async () => {
    const [item] = await listed(
      [
        copy(
          'organized',
          'calendar-colleague',
          { email: 'user@example.com', isOrganizer: true },
          false,
        ),
      ],
      [
        {
          id: 'calendar-colleague',
          emailAddress: 'user@example.com',
          contributesToAvailability: false,
        },
      ],
    );

    expect(item?.role).toBe('organizer');
  });

  test('keep the organizer role on a calendar of the user’s schedule', async () => {
    const [noGuests, invitedBySecondary] = await listed(
      [
        copy('no-guests', 'calendar-own', null, true),
        copy(
          'invited-by-secondary',
          'calendar-own',
          { email: 'user@example.com', isOrganizer: false },
          true,
        ),
      ],
      [
        {
          id: 'calendar-own',
          emailAddress: 'user@example.com',
          contributesToAvailability: true,
        },
      ],
    );

    expect(noGuests?.role).toBe('organizer');
    expect(invitedBySecondary?.role).toBe('organizer');
  });
});
