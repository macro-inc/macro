export type CalendarCallPerson = {
  id?: string;
  photoUrl?: string;
  name?: string;
  email: string;
  status?: string;
  organizer?: boolean;
};

/** Calendar information supplied by the host, independent of calendar providers. */
export type CalendarCallEvent = {
  eventId: string;
  occurrenceKey: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  timeZone?: string;
  account?: string;
  url: string;
  attendees: CalendarCallPerson[];
  external?: boolean;
  canEdit?: boolean;
  canInvite?: boolean;
  recurring?: boolean;
};

export type CalendarCallLink = {
  id: string;
  title: string;
  url: string;
  start?: string;
  end?: string;
  callId?: string;
  channelId?: string;
};

export type CalendarCallRecord = {
  id: string;
  title: string;
  startedAt: string;
  active: boolean;
  channelId?: string;
  durationMs?: number;
  status?: string;
  people: string[];
  participants?: CalendarCallPerson[];
  participantCount?: number;
  channelName?: string;
  summary?: string;
};

export type CalendarCallGroup = 'live' | 'scheduled' | 'instant' | 'recent';
export type CalendarCallItem = {
  id: string;
  title: string;
  group: CalendarCallGroup;
  start?: string;
  end?: string;
  link?: CalendarCallLink;
  event?: CalendarCallEvent;
  record?: CalendarCallRecord;
};

export const CALENDAR_CALL_GROUPS: {
  id: CalendarCallGroup;
  title: string;
  description: string;
}[] = [
  { id: 'live', title: 'Live now', description: 'Calls in progress' },
  { id: 'scheduled', title: 'Scheduled', description: 'Scheduled call links' },
  {
    id: 'instant',
    title: 'Quick Calls',
    description: 'Reusable links · not on the calendar',
  },
  {
    id: 'recent',
    title: 'Recent calls',
    description: 'Past scheduled calls and recordings',
  },
];

function linkKey(url: string) {
  try {
    return new URL(url).pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function scheduleTimestamp(value: string, allDay?: boolean) {
  return Date.parse(allDay ? `${value.slice(0, 10)}T00:00:00` : value);
}

/** Do not infer an archived session's schedule or calendar event from its title. */
export function buildCalendarCallItems(
  links: CalendarCallLink[],
  events: CalendarCallEvent[],
  records: CalendarCallRecord[],
  now = Date.now()
): CalendarCallItem[] {
  const representedCalls = new Set<string>();
  const representedEvents = new Set<string>();
  const eventKey = (event: CalendarCallEvent) =>
    `${event.eventId}:${event.occurrenceKey}`;
  const items: CalendarCallItem[] = links.map((link) => {
    const matchingEvents = events.filter(
      (event) => !event.external && linkKey(event.url) === linkKey(link.url)
    );
    // A recurring link can appear on several occurrences. Prefer its stored schedule.
    const event =
      matchingEvents.find((candidate) => candidate.start === link.start) ??
      matchingEvents[0];
    if (event) representedEvents.add(eventKey(event));
    const record = records.find((candidate) => candidate.id === link.callId);
    if (link.callId) representedCalls.add(link.callId);
    const start = event?.start ?? link.start;
    return {
      id: `meeting:${link.id}`,
      title: event?.title ?? link.title,
      group:
        link.callId && record?.active !== false
          ? 'live'
          : start
            ? scheduleTimestamp(
                event?.end ?? link.end ?? start,
                event?.allDay
              ) <= now
              ? 'recent'
              : 'scheduled'
            : 'instant',
      start,
      end: event?.end ?? link.end,
      link,
      event,
      record,
    };
  });
  for (const event of events) {
    if (representedEvents.has(eventKey(event))) continue;
    items.push({
      id: `event:${eventKey(event)}`,
      title: event.title,
      group:
        scheduleTimestamp(event.end, event.allDay) <= now
          ? 'recent'
          : 'scheduled',
      start: event.start,
      end: event.end,
      event,
    });
  }
  for (const record of records) {
    if (representedCalls.has(record.id)) continue;
    items.push({
      id: `record:${record.id}`,
      title: record.title,
      group: record.active ? 'live' : 'recent',
      start: record.startedAt,
      record,
    });
  }
  return items.sort((a, b) => {
    const group =
      CALENDAR_CALL_GROUPS.findIndex((value) => value.id === a.group) -
      CALENDAR_CALL_GROUPS.findIndex((value) => value.id === b.group);
    if (group) return group;
    const time =
      (Date.parse(a.start ?? '') || 0) - (Date.parse(b.start ?? '') || 0);
    return a.group === 'scheduled' ? time : -time;
  });
}

export function calendarCallUrl(item: CalendarCallItem) {
  return item.link?.url ?? item.event?.url;
}

/** Join live sessions or scheduled calls during their calendar time window. */
export function calendarCallCanJoin(item: CalendarCallItem, now: Date) {
  if (item.group === 'live') return item.record?.active !== false;
  if (item.group !== 'scheduled' || !calendarCallUrl(item)) return false;
  const start = item.start ?? item.event?.start ?? item.link?.start;
  const end = item.end ?? item.event?.end ?? item.link?.end;
  if (!start || !end) return false;
  return (
    scheduleTimestamp(start, item.event?.allDay) <= now.getTime() &&
    now.getTime() < scheduleTimestamp(end, item.event?.allDay)
  );
}

export function calendarCallPeople(item: CalendarCallItem): string[] {
  return item.record?.people.length
    ? item.record.people
    : (item.event?.attendees
        .filter((person) => person.status !== 'declined')
        .map((person) => person.name ?? person.email) ?? []);
}

export function calendarCallParticipants(
  item: CalendarCallItem
): CalendarCallPerson[] {
  if (item.group === 'live' && item.record?.participants?.length)
    return item.record.participants;
  return (
    item.event?.attendees ??
    item.record?.participants ??
    item.record?.people.map((name) => ({ name, email: '' })) ??
    []
  );
}

export function calendarCallDuration(item: CalendarCallItem) {
  const start = item.start ?? item.event?.start;
  const end = item.end ?? item.event?.end;
  const duration =
    item.record?.durationMs ??
    (start && end ? Date.parse(end) - Date.parse(start) : 0);
  if (!duration || duration < 0 || !Number.isFinite(duration)) return undefined;
  const minutes = Math.max(1, Math.round(duration / 60_000));
  return minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`;
}

export function calendarCallTime(item: CalendarCallItem) {
  if (item.event?.allDay) return 'All day';
  const start = item.start ?? item.event?.start;
  if (!start || !Number.isFinite(Date.parse(start))) return 'Any time';
  return new Date(start).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Date headers and row times use the viewer's local calendar consistently. */
export function groupCalendarCallsByDay(items: CalendarCallItem[], now: Date) {
  const groups = new Map<
    string,
    { key: string; label: string; date: string; items: CalendarCallItem[] }
  >();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  for (const item of items) {
    const start = item.start ?? item.event?.start;
    const date = start
      ? new Date(item.event?.allDay ? `${start.slice(0, 10)}T12:00:00` : start)
      : undefined;
    const validDate =
      date && Number.isFinite(date.getTime()) ? date : undefined;
    const key = validDate?.toDateString() ?? 'undated';
    const formatted =
      validDate?.toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        ...(validDate.getFullYear() !== now.getFullYear()
          ? { year: 'numeric' as const }
          : {}),
      }) ?? '';
    const label =
      key === now.toDateString()
        ? 'Today'
        : key === tomorrow.toDateString()
          ? 'Tomorrow'
          : formatted || 'Calls';
    if (!groups.has(key))
      groups.set(key, { key, label, date: formatted, items: [] });
    groups.get(key)!.items.push(item);
  }
  return [...groups.values()];
}

export function calendarCallGuests(item: CalendarCallItem) {
  const account = item.event?.account;
  const domain = account?.includes('@')
    ? account.split('@')[1]?.toLowerCase()
    : undefined;
  return domain
    ? (item.event?.attendees.filter(
        (person) => person.email.split('@')[1]?.toLowerCase() !== domain
      ) ?? [])
    : [];
}

/** Preserve another Macro environment's host instead of sending its token to this backend. */
export function calendarCallNavigation(value: string, webOrigin: string) {
  const url = new URL(value, webOrigin);
  return url.origin === new URL(webOrigin).origin
    ? {
        kind: 'internal' as const,
        path: `${url.pathname.replace(/^\/app(?=\/)/, '')}${url.search}${url.hash}`,
      }
    : { kind: 'external' as const, url: url.toString() };
}

export function calendarCallDate(
  value: string | undefined,
  timeZone?: string,
  allDay = false
) {
  if (!value) return undefined;
  const date = new Date(allDay ? `${value.slice(0, 10)}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(allDay ? {} : { hour: 'numeric', minute: '2-digit', timeZone }),
  }).format(date);
}
