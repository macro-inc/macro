import { afterEach, describe, expect, test } from 'bun:test';
import type {
  BookingLinkDraft,
  BookingLink as BookingLinkRecord,
  Booking as BookingRecord,
  Profile,
} from '../generated/calendar/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const PROFILE_ID = '0198a4cc-e138-7670-a308-a6b766602710';
const LINK_ID = '0198a4cc-e138-7670-a308-a6b766602711';
const SCHEDULE_ID = '0198a4cc-e138-7670-a308-a6b766602712';
const TEAM_ID = '0198a4cc-e138-7670-a308-a6b766602713';
const BOOKING_ID = '0198a4cc-e138-7670-a308-a6b766602714';
const QUESTION_ID = '0198a4cc-e138-7670-a308-a6b766602715';
const HOST = 'macro|host@example.com';

const draft: BookingLinkDraft = {
  event: {
    title: 'Intro call',
    slug: 'intro',
    description: '',
    durationMinutes: 30,
    location: '',
    macroCall: true,
    googleMeet: false,
    enabled: true,
    mode: 'individual',
    hosts: [HOST],
    beforeMinutes: 0,
    afterMinutes: 0,
    noticeMinutes: 60,
    horizonDays: 30,
    intervalMinutes: 30,
    dailyLimit: null,
    requiresConfirmation: false,
    questions: [],
  },
  schedule: {
    name: 'Working hours',
    timeZone: 'America/New_York',
    weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      windows: day === 0 || day === 6 ? [] : [{ start: '09:00', end: '17:00' }],
    })),
    overrides: [],
  },
};

const link: BookingLinkRecord = {
  profileId: PROFILE_ID,
  eventTypeId: LINK_ID,
  revision: 4,
  draft,
};

const booking: BookingRecord = {
  id: BOOKING_ID,
  eventTypeId: LINK_ID,
  title: 'Intro call',
  name: 'Guest',
  email: 'guest@example.com',
  startsAt: '2026-11-10T15:00:00Z',
  endsAt: '2026-11-10T15:30:00Z',
  timeZone: 'Europe/London',
  hosts: [HOST],
  status: 'confirmed',
  attendance: 'unknown',
  rescheduleCount: 0,
  rescheduledAt: null,
  location: 'https://macro.com/app/call/abc',
  answers: { [QUESTION_ID]: 'Pricing' },
  questionLabels: { [QUESTION_ID]: 'What would you like to cover?' },
};

type Call = { method: string; url: string; body: unknown };

/** Answer each request with the next response, recording what was sent. */
function serve(...responses: { status: number; body?: unknown }[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const text = await request.text();
    calls.push({
      method: request.method,
      url: request.url,
      body: text ? JSON.parse(text) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${request.url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function macro(): Macro {
  return new Macro({
    auth: { type: 'user', token: 'user-key' },
    hosts: { calendar: 'https://calendar.example.test' },
    webAppUrl: 'https://macro.example.test',
  });
}

describe('booking links', () => {
  test('links lists a team page as handles with their share URL and chip', async () => {
    const calls = serve({
      status: 200,
      body: {
        teamIds: [TEAM_ID],
        userId: HOST,
        profileId: PROFILE_ID,
        revision: 4,
        schedules: [{ id: SCHEDULE_ID, ...draft.schedule }],
        links: [link],
      },
    });
    const sdk = macro();
    const team = sdk.teams.byId(TEAM_ID);

    const listing = await sdk.bookings.links({ team, query: 'intro' });

    expect(calls).toEqual([
      {
        method: 'GET',
        url: `https://calendar.example.test/scheduling/links?teamId=${TEAM_ID}&query=intro`,
        body: undefined,
      },
    ]);
    expect(listing.me.id).toBe(HOST);
    expect(listing.teams.map((t) => t.id)).toEqual([TEAM_ID]);
    expect(listing.schedules[0]?.id).toBe(SCHEDULE_ID);
    const [found] = listing.links;
    expect(found?.id).toBe(LINK_ID);
    expect(found?.team).toBe(team);
    expect(found?.revision).toBe(4);
    expect(found?.draft).toEqual(draft);
    expect(found?.webUrl()).toBe(
      `https://macro.example.test/app/book/${PROFILE_ID}/intro`,
    );
    expect(found?.mentionTag()).toBe(
      `<m-booking-link-mention>{"profileId":"${PROFILE_ID}","slug":"intro","url":"https://macro.example.test/app/book/${PROFILE_ID}/intro","label":""}</m-booking-link-mention>`,
    );
    expect(JSON.parse(JSON.stringify(found))).toEqual({
      id: LINK_ID,
      detail: link,
      url: `https://macro.example.test/app/book/${PROFILE_ID}/intro`,
    });
  });

  test('createLink posts the draft and edit saves against the revision it read', async () => {
    const edited: BookingLinkDraft = {
      ...draft,
      event: { ...draft.event, durationMinutes: 45 },
    };
    const calls = serve(
      { status: 200, body: { link } },
      { status: 200, body: { link: { ...link, revision: 5, draft: edited } } },
    );

    const created = await macro().bookings.createLink(draft);
    const saved = await created.edit(edited);

    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://calendar.example.test/scheduling/links',
        body: draft,
      },
      {
        method: 'PUT',
        url: `https://calendar.example.test/scheduling/links/${LINK_ID}`,
        body: { expectedRevision: 4, draft: edited },
      },
    ]);
    expect(created.team).toBeUndefined();
    expect(saved.revision).toBe(5);
    expect(saved.draft.event.durationMinutes).toBe(45);
  });
});

describe('bookings', () => {
  test('bookings reads a range and reschedule moves to an offered slot', async () => {
    const slot = {
      startsAt: '2026-11-11T16:00:00Z',
      endsAt: '2026-11-11T16:30:00Z',
    };
    const calls = serve(
      { status: 200, body: { bookings: [booking] } },
      { status: 200, body: { slots: [slot] } },
      {
        status: 200,
        body: {
          booking: {
            ...booking,
            ...slot,
            rescheduleCount: 1,
            rescheduledAt: '2026-11-05T12:00:00Z',
          },
        },
      },
    );

    const [found] = await macro().bookings.bookings({
      from: new Date('2026-11-01T00:00:00Z'),
      to: '2026-12-01T00:00:00Z',
    });
    if (!found) throw new Error('no booking');
    const [offered] = await found.rescheduleSlots('2026-11-11');
    if (!offered) throw new Error('no slot');
    const moved = await found.reschedule(offered);

    expect(calls).toEqual([
      {
        method: 'GET',
        url: 'https://calendar.example.test/scheduling/bookings?from=2026-11-01T00%3A00%3A00.000Z&to=2026-12-01T00%3A00%3A00Z',
        body: undefined,
      },
      {
        method: 'GET',
        url: `https://calendar.example.test/scheduling/bookings/${BOOKING_ID}/slots?date=2026-11-11`,
        body: undefined,
      },
      {
        method: 'POST',
        url: `https://calendar.example.test/scheduling/bookings/${BOOKING_ID}/change`,
        body: { action: 'reschedule', startsAt: '2026-11-11T16:00:00Z' },
      },
    ]);
    expect(found.guestName).toBe('Guest');
    expect(found.hosts.map((host) => host.id)).toEqual([HOST]);
    expect(found.answers).toEqual([
      { question: 'What would you like to cover?', answer: 'Pricing' },
    ]);
    expect(moved.startsAt).toBe('2026-11-11T16:00:00Z');
    expect(moved.rescheduleCount).toBe(1);
  });

  test('cancel and recordAttendance send their change', async () => {
    const calls = serve(
      { status: 200, body: { bookings: [booking] } },
      { status: 200, body: { booking: { ...booking, status: 'cancelled' } } },
      {
        status: 200,
        body: { booking: { ...booking, attendance: 'guestNoShow' } },
      },
    );

    const [found] = await macro().bookings.bookings({
      from: '2026-11-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    });
    if (!found) throw new Error('no booking');
    const cancelled = await found.cancel();
    const recorded = await found.recordAttendance('guestNoShow');

    expect(calls.slice(1)).toEqual([
      {
        method: 'POST',
        url: `https://calendar.example.test/scheduling/bookings/${BOOKING_ID}/change`,
        body: { action: 'cancel' },
      },
      {
        method: 'POST',
        url: `https://calendar.example.test/scheduling/bookings/${BOOKING_ID}/change`,
        body: { action: 'attendance', attendance: 'guestNoShow' },
      },
    ]);
    expect(cancelled.status).toBe('cancelled');
    expect(recorded.attendance).toBe('guestNoShow');
  });

  test('insights filters by a link and host handle', async () => {
    const calls = serve(
      {
        status: 200,
        body: {
          teamIds: [],
          userId: HOST,
          profileId: PROFILE_ID,
          revision: 4,
          schedules: [],
          links: [link],
        },
      },
      {
        status: 200,
        body: {
          asOf: '2026-11-05T12:00:00Z',
          previousFrom: '2026-09-30',
          previousTo: '2026-10-30',
          current: {
            counts: {
              total: 3,
              completed: 2,
              rescheduled: 0,
              cancelled: 1,
              guestNoShow: 0,
              hostNoShow: 0,
            },
            meetingMinutes: 60,
            averageMinutes: 30,
            days: {},
            hours: [],
            eventCounts: { [LINK_ID]: 3 },
            hostCounts: { [HOST]: 3 },
          },
          previous: {
            counts: {
              total: 0,
              completed: 0,
              rescheduled: 0,
              cancelled: 0,
              guestNoShow: 0,
              hostNoShow: 0,
            },
            meetingMinutes: 0,
            averageMinutes: 0,
            days: {},
            hours: [],
            eventCounts: {},
            hostCounts: {},
          },
        },
      },
    );
    const sdk = macro();

    const listing = await sdk.bookings.links();
    const insights = await sdk.bookings.insights({
      from: '2026-10-31',
      to: '2026-11-30',
      timeZone: 'America/New_York',
      link: listing.links[0],
      host: listing.me,
    });

    expect(calls[1]).toEqual({
      method: 'POST',
      url: 'https://calendar.example.test/scheduling/insights',
      body: {
        from: '2026-10-31',
        to: '2026-11-30',
        timeZone: 'America/New_York',
        eventTypeId: LINK_ID,
        hostId: HOST,
      },
    });
    expect(insights.current.counts.total).toBe(3);
  });
});

describe('booking settings', () => {
  test('save sends the full profile at the revision it was read at', async () => {
    const profile: Profile = {
      id: PROFILE_ID,
      name: 'Host',
      description: '',
      schedules: [{ id: SCHEDULE_ID, ...draft.schedule }],
      defaultScheduleId: SCHEDULE_ID,
      eventTypes: [],
      revision: 4,
    };
    const calls = serve(
      { status: 200, body: { profile } },
      {
        status: 200,
        body: { profile: { ...profile, name: 'Renamed', revision: 5 } },
      },
    );
    const sdk = macro();
    const team = sdk.teams.byId(TEAM_ID);

    const settings = await sdk.bookings.settings({ team });
    const saved = await settings.save({
      ...settings.profile,
      name: 'Renamed',
      revision: 99,
    });

    expect(calls).toEqual([
      {
        method: 'GET',
        url: `https://calendar.example.test/scheduling/settings?teamId=${TEAM_ID}`,
        body: undefined,
      },
      {
        method: 'PUT',
        url: `https://calendar.example.test/scheduling/settings?teamId=${TEAM_ID}`,
        body: { ...profile, name: 'Renamed', revision: 4 },
      },
    ]);
    expect(settings.webUrl()).toBe(
      `https://macro.example.test/app/book/${PROFILE_ID}`,
    );
    expect(saved.profile.revision).toBe(5);
    expect(saved.team).toBe(team);
  });
});
