import { describe, expect, test } from 'bun:test';
import type { CalendarEvent as CalendarEventRecord } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { CalendarNamespace } from './namespace';

function copy(
  id: string,
  calendarId: string,
  self: { email: string; isOrganizer: boolean } | null,
  organize: boolean,
): CalendarEventRecord {
  return {
    id,
    ownerId: 'macro|user@example.com',
    calendarId,
    icalUid: 'meeting@google.com',
    title: 'Planning',
    attendees: self
      ? [
          {
            email: self.email,
            responseStatus: 'needs_action',
            isOrganizer: self.isOrganizer,
            isOptional: false,
            isSelf: true,
          },
        ]
      : [],
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

describe('calendar occurrences', () => {
  test('name the inbox and role of each copy of a meeting', async () => {
    let calendarReads = 0;
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
                { id: 'calendar-owner', emailAddress: 'owner@example.com' },
                { id: 'calendar-guest', emailAddress: 'guest@example.com' },
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
});
