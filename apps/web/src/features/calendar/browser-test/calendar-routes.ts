import type { Page, Route } from '@playwright/test';
import { serveFromNode } from './serve-from-node';

/** One occurrence as the storage service lists it. */
export interface WireItem {
  event: Record<string, unknown> & { id: string; title: string };
  occurrence: Record<string, unknown>;
}

interface WireEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  recurrenceLines?: string[];
  description?: string;
  /** The viewer's calendars holding a copy of the event; the first is canonical. */
  calendarIds?: string[];
}

/** An event the viewer organizes on their own calendar. */
export function organizedEvent(event: WireEvent): WireItem {
  const time = {
    kind: 'timed',
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: 'America/New_York',
  };
  return {
    event: {
      id: event.id,
      title: event.title,
      description: event.description ?? null,
      time,
      recurrenceLines: event.recurrenceLines ?? [],
      attendees: [],
      calendarId: event.calendarIds?.[0] ?? 'calendar-1',
      sources: (event.calendarIds ?? []).map((calendarId) => ({
        calendarId,
        title: event.title,
        eventType: 'default',
        isReadOnly: false,
        reminders: { useDefault: true, overrides: [] },
        transparency: 'opaque',
        visibility: 'default',
      })),
      createdAt: '2029-12-01T00:00:00Z',
      updatedAt: '2029-12-01T00:00:00Z',
      guestPolicy: {
        canInviteOthers: true,
        canModify: false,
        canSeeOtherGuests: true,
      },
      icalUid: `${event.id}@example.com`,
      isReadOnly: false,
      isSnapshot: false,
      organizerEmail: 'viewer@example.com',
      ownerId: 'macro|viewer@example.com',
      sequence: 0,
      status: 'confirmed',
      transparency: 'opaque',
      visibility: 'default',
      viewerCan: {
        editDetails: true,
        inviteGuests: true,
        removeGuests: true,
        setGuestPolicy: true,
        rsvp: false,
        organize: true,
      },
    },
    occurrence: {
      eventId: event.id,
      occurrenceKey: event.startsAt,
      isCancelled: false,
      time,
    },
  };
}

/** Noon to one, New York time, on Wednesday 2 January 2030, repeating weekly with no weekday named. */
export const weeklyReview = () =>
  organizedEvent({
    id: 'event-weekly',
    title: 'Weekly review',
    startsAt: '2030-01-02T17:00:00Z',
    endsAt: '2030-01-02T18:00:00Z',
    recurrenceLines: ['RRULE:FREQ=WEEKLY'],
  });

/** A one-off hour on Thursday 3 January 2030. */
export const planning = () =>
  organizedEvent({
    id: 'event-planning',
    title: 'Planning',
    startsAt: '2030-01-03T15:00:00Z',
    endsAt: '2030-01-03T16:00:00Z',
  });

export interface CalendarServer {
  /** The events every occurrence read answers with. */
  events: WireItem[];
  /** Every event change the app sent, in order. */
  patches: { path: string; eventId: string; body: Record<string, unknown> }[];
  /** The path of every read of the viewer's calendar list. */
  calendarListReads: string[];
  /**
   * Leaves occurrence reads unanswered from now on. Resolves `held` with the
   * first one, and `release` answers them all and later ones.
   */
  holdReads: () => { held: Promise<void>; release: () => Promise<void> };
}

/**
 * Answers the calendar's routes as the gateway mounts them: occurrence reads
 * from the storage service, the calendar list and event changes under
 * `/calendar`. A change is applied to `events` before it is answered, as the
 * provider's answer carries the saved event.
 */
export async function answerCalendar(
  page: Page,
  initial: { events: WireItem[] }
): Promise<CalendarServer> {
  await serveFromNode(page);
  let waiting: Route[] | undefined;
  let onHeld: (() => void) | undefined;
  const occurrences = () => ({
    json: { hasMore: false, items: server.events, syncStatus: 'ready' },
  });
  const server: CalendarServer = {
    events: initial.events,
    patches: [],
    calendarListReads: [],
    holdReads: () => {
      const routes: Route[] = [];
      waiting = routes;
      const held = new Promise<void>((resolve) => {
        onHeld = resolve;
      });
      return {
        held,
        release: async () => {
          waiting = undefined;
          await Promise.all(
            routes.map((route) => route.fulfill(occurrences()))
          );
        },
      };
    },
  };
  await page.route('**/dss/calendar-events?*', (route) => {
    if (!waiting) return route.fulfill(occurrences());
    waiting.push(route);
    onHeld?.();
  });
  await page.route('**/calendar/calendars', (route) => {
    server.calendarListReads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { calendars: [] } });
  });
  await page.route('**/calendar/events/*', (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') return route.fallback();
    const path = new URL(request.url()).pathname;
    const eventId = path.split('/').at(-1) ?? '';
    const body = request.postDataJSON() as Record<string, unknown>;
    server.patches.push({ path, eventId, body });
    const item = server.events.find((entry) => entry.event.id === eventId);
    if (!item) return route.fulfill({ status: 404, json: {} });
    if (typeof body.title === 'string') item.event.title = body.title;
    for (const field of ['time', 'recurrenceLines'] as const)
      if (body[field] !== undefined) item.event[field] = body[field];
    if (body.time !== undefined) item.occurrence.time = body.time;
    return route.fulfill({ json: item.event });
  });
  return server;
}
