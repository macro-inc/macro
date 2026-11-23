import { describe, expect, test } from 'bun:test';
import type {
  BookingLinkDraft,
  BookingLink as BookingLinkRecord,
  Booking as BookingRecord,
} from '../../../generated/calendar/types.gen';
import type { MacroClient } from '../../utils/client';
import { Team } from '../teams/team';
import { BookingNamespace } from './booking-namespace';

const draft: BookingLinkDraft = {
  event: {
    title: 'Intro',
    slug: 'intro',
    description: '',
    durationMinutes: 30,
    location: 'Office',
    googleMeet: false,
    enabled: true,
    mode: 'individual',
    hosts: ['macro|owner@example.com'],
    beforeMinutes: 0,
    afterMinutes: 0,
    noticeMinutes: 60,
    horizonDays: 30,
    intervalMinutes: 30,
    requiresConfirmation: false,
    questions: [],
  },
  schedule: {
    name: 'Working hours',
    timeZone: 'UTC',
    weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      windows: [{ start: '09:00', end: '17:00' }],
    })),
    overrides: [],
  },
};

const saved: BookingLinkRecord = {
  profileId: 'profile-1',
  eventTypeId: 'link-1',
  revision: 3,
  draft,
};

const booking: BookingRecord = {
  id: 'booking-1',
  eventTypeId: 'link-1',
  title: 'Intro',
  name: 'Guest',
  email: 'guest@example.com',
  startsAt: '2026-01-05T09:00:00Z',
  endsAt: '2026-01-05T09:30:00Z',
  timeZone: 'UTC',
  hosts: ['macro|owner@example.com'],
  status: 'confirmed',
  attendance: 'unknown',
  rescheduleCount: 0,
  location: 'Office',
  answers: {},
  questionLabels: {},
};

describe('calendar.booking', () => {
  test('lists a team’s links as handles with their booking URLs', async () => {
    const queries: unknown[] = [];
    const client = {
      webAppUrl: 'https://macro.com',
      calendar: {
        listBookingLinks: async (options: unknown) => {
          queries.push(options);
          return {
            data: {
              teamIds: ['team-1'],
              userId: 'macro|owner@example.com',
              profileId: 'profile-1',
              revision: 3,
              schedules: [],
              links: [saved],
            },
          };
        },
      },
    } as unknown as MacroClient;
    const team = Team.byId(client, 'team-1');

    const listing = await new BookingNamespace(client).links({
      team,
      query: 'intro',
    });

    expect(queries).toEqual([{ query: { teamId: 'team-1', query: 'intro' } }]);
    expect(listing.host.id).toBe('macro|owner@example.com');
    expect(listing.teams.map((t) => t.id)).toEqual(['team-1']);
    expect(listing.pageUrl).toBe('https://macro.com/app/book/profile-1');
    const [link] = listing.links;
    expect(link?.id).toBe('link-1');
    expect(link?.team).toBe(team);
    expect(await link?.webUrl()).toBe(
      'https://macro.com/app/book/profile-1/intro',
    );
    expect(JSON.parse(JSON.stringify(link))).toMatchObject({
      id: 'link-1',
      url: 'https://macro.com/app/book/profile-1/intro',
    });
  });

  test('creates and edits a link with the quoted approval and the read revision', async () => {
    const calls: { method: string; options: unknown }[] = [];
    const client = {
      webAppUrl: 'https://macro.com',
      calendar: {
        createBookingLink: async (options: unknown) => {
          calls.push({ method: 'create', options });
          return { data: saved };
        },
        editBookingLink: async (options: unknown) => {
          calls.push({ method: 'edit', options });
          return { data: { ...saved, revision: 4 } };
        },
      },
    } as unknown as MacroClient;

    const link = await new BookingNamespace(client).createLink(draft, {
      userConfirmation: 'Yes, create it.',
    });
    const renamed = {
      ...draft,
      event: { ...draft.event, title: 'Intro call' },
    };
    const edited = await link.edit(renamed, {
      userConfirmation: 'Yes, rename it.',
    });

    expect(calls).toEqual([
      {
        method: 'create',
        options: {
          query: { teamId: undefined },
          body: { draft, userConfirmation: 'Yes, create it.' },
        },
      },
      {
        method: 'edit',
        options: {
          path: { id: 'link-1' },
          query: { teamId: undefined },
          body: {
            expectedRevision: 3,
            draft: renamed,
            userConfirmation: 'Yes, rename it.',
          },
        },
      },
    ]);
    expect(await edited.revision()).toBe(4);
  });

  test('lists bookings in a range and reschedules one to an offered slot', async () => {
    const calls: { method: string; options: unknown }[] = [];
    const client = {
      webAppUrl: 'https://macro.com',
      calendar: {
        listBookings: async (options: unknown) => {
          calls.push({ method: 'list', options });
          return { data: { bookings: [booking] } };
        },
        listBookingRescheduleSlots: async (options: unknown) => {
          calls.push({ method: 'slots', options });
          return {
            data: {
              slots: [
                {
                  startsAt: '2026-01-06T10:00:00Z',
                  endsAt: '2026-01-06T10:30:00Z',
                },
              ],
            },
          };
        },
        changeBooking: async (options: unknown) => {
          calls.push({ method: 'change', options });
          return {
            data: {
              booking: {
                ...booking,
                startsAt: '2026-01-06T10:00:00Z',
                endsAt: '2026-01-06T10:30:00Z',
                rescheduleCount: 1,
              },
            },
          };
        },
      },
    } as unknown as MacroClient;

    const [found] = await new BookingNamespace(client).bookings({
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    if (!found) throw new Error('expected a booking');
    expect((await found.hosts()).map((host) => host.id)).toEqual([
      'macro|owner@example.com',
    ]);
    const [slot] = await found.rescheduleSlots('2026-01-06');
    if (!slot) throw new Error('expected a slot');
    const moved = await found.reschedule(slot.startsAt);

    expect(await moved.rescheduleCount()).toBe(1);
    expect(calls).toEqual([
      {
        method: 'list',
        options: {
          query: {
            teamId: undefined,
            from: '2026-01-01T00:00:00Z',
            to: '2026-02-01T00:00:00Z',
          },
        },
      },
      {
        method: 'slots',
        options: { path: { id: 'booking-1' }, query: { date: '2026-01-06' } },
      },
      {
        method: 'change',
        options: {
          path: { id: 'booking-1' },
          body: { action: 'reschedule', startsAt: '2026-01-06T10:00:00Z' },
        },
      },
    ]);
  });
});
