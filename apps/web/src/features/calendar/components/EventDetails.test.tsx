/**
 * @vitest-environment jsdom
 */

import {
  type CalendarEvent,
  mapCalendarOccurrence,
} from '@app/features/calendar/types';
import { mapCalendarOccurrence as mapGraphqlOccurrence } from '@queries/calendar/graphql/map';
import { executeGraphqlCreate } from '@queries/calendar/graphql/mutations';
import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import type { CalendarOccurrenceItemFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { Client } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEventTime,
  defaultEditorInitialValues,
} from './composer/event-form-model';
import { EventAttendeesSection, EventDetails } from './EventDetails';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => document.createElement('span'),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
// Macro profile and contact names; any other address has no name and falls
// back to itself, as the real lookup does.
vi.mock('@core/user', async (importOriginal) => {
  const names: Record<string, string> = {
    'macro|bea@outside.example': 'Bea Booker',
    'macro|me@example.com': 'Mo Viewer',
    'macro|host@example.com': 'Hana Host',
  };
  return {
    ...(await importOriginal<typeof import('@core/user')>()),
    getDisplayName: (id?: string) =>
      id ? (names[id] ?? id.replace(/^macro\|/, '')) : '',
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function attendee(overrides: Partial<CalendarAttendee>): CalendarAttendee {
  return {
    email: 'guest@example.com',
    isOptional: false,
    isOrganizer: false,
    isSelf: false,
    responseStatus: 'accepted',
    ...overrides,
  };
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: '["event-1","2026-10-22T14:00:00Z"]',
    eventId: 'event-1',
    occurrenceKey: '2026-10-22T14:00:00Z',
    isCancelled: false,
    isReadOnly: false,
    guestPolicy: {
      canModify: false,
      canInviteOthers: true,
      canSeeOtherGuests: true,
    },
    viewerCan: {
      editDetails: false,
      inviteGuests: false,
      removeGuests: false,
      setGuestPolicy: false,
      rsvp: true,
      organize: false,
    },
    attendees: [],
    recurrenceLines: [],
    sourceCalendarIds: ['calendar-1'],
    calendarId: 'calendar-1',
    title: 'Planning',
    start: '2026-10-22T14:00:00Z',
    end: '2026-10-22T15:00:00Z',
    allDay: false,
    calendar: { id: 'calendar-1', name: 'Calendar', color: 'orange' },
    visibleCalendars: [],
    ...overrides,
  };
}

describe('the guest list in event details', () => {
  it('shows each named guest’s address under their name', () => {
    render(() => (
      <EventAttendeesSection
        attendees={[
          attendee({ email: 'bea@outside.example' }),
          attendee({ email: 'me@example.com', isSelf: true }),
        ]}
      />
    ));

    expect(screen.getByText('Bea Booker')).toBeTruthy();
    expect(screen.getByText('bea@outside.example')).toBeTruthy();
    expect(screen.getByText('Mo Viewer (you)')).toBeTruthy();
    expect(screen.getByText('me@example.com')).toBeTruthy();
  });

  it('shows a guest without a name by their address, once', () => {
    render(() => (
      <EventAttendeesSection
        attendees={[attendee({ email: 'nameless@outside.example' })]}
      />
    ));

    expect(screen.getAllByText('nameless@outside.example')).toHaveLength(1);
  });
});

describe('the organizer in event details', () => {
  it('shows the organizer’s address under their name', () => {
    render(() => (
      <EventDetails
        event={event({
          organizerName: 'Hana Host',
          organizerEmail: 'host@example.com',
        })}
        timeFormat="12-hour"
      />
    ));

    expect(screen.getByText('Hana Host')).toBeTruthy();
    expect(screen.getByText('host@example.com')).toBeTruthy();
  });

  it('shows an organizer known only by address once', () => {
    render(() => (
      <EventDetails
        event={event({ organizerEmail: 'organizer@outside.example' })}
        timeFormat="12-hour"
      />
    ));

    expect(screen.getAllByText('organizer@outside.example')).toHaveLength(1);
  });
});

describe('the local copy of a new event', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The event the calendar draws for a create before the server answers. */
  async function localCopy(): Promise<CalendarEvent> {
    let created: CalendarOccurrenceItemFieldsFragment | undefined;
    const client = {
      mutation: (
        _document: unknown,
        _variables: unknown,
        context: Record<string, unknown>
      ) => {
        const optimistic = context.normalizedCacheOptimistic as {
          optimisticResponse: {
            createCalendarEvent: {
              occurrences: CalendarOccurrenceItemFieldsFragment[];
            };
          };
        };
        created =
          optimistic.optimisticResponse.createCalendarEvent.occurrences[0];
        return {
          toPromise: async () => ({
            operation: { context },
            extensions: {
              normalizedCacheMutationDisposition: {
                kind: 'queued',
                transactionId: 'tx-1',
              },
            },
          }),
        };
      },
      query: () => ({ toPromise: async () => ({ data: undefined }) }),
    } as unknown as Client;
    // The editor's own time, which names the browser's time zone.
    const time = buildEventTime(
      defaultEditorInitialValues(new Date('2026-11-28T09:30:00'))
    );
    if (!time) throw new Error('the editor built no time');
    await executeGraphqlCreate({ title: 'Offsite', time }, client);
    if (!created) throw new Error('the create drew no occurrence');
    return mapCalendarOccurrence(mapGraphqlOccurrence(created));
  }

  it.each(['UTC', 'America/New_York'])(
    'shows no original time to a viewer in %s',
    async (timeZone) => {
      vi.stubEnv('TZ', timeZone);
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timeZone);

      const local = await localCopy();
      render(() => <EventDetails event={local} timeFormat="12-hour" />);

      expect(screen.getByText('Offsite')).toBeTruthy();
      expect(screen.queryByText(/Original time/)).toBeNull();
    }
  );
});
