import { deepEqual } from '@core/util/compareUtils';
import type { CalendarEvent } from '@service-storage/generated/schemas/calendarEvent';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { EventTime } from '@service-storage/generated/schemas/eventTime';
import { hashKey, type Query, type QueryClient } from '@tanstack/solid-query';
import { type CalendarOccurrenceQueryRange, calendarKeys } from './keys';
import type { UpdateCalendarEventArgs } from './mutations';
import type { CalendarOccurrencesData } from './occurrences';
import { projectCalendarOccurrenceTime } from './optimistic-time';

type Patch = UpdateCalendarEventArgs['patch'];

interface ViewportSnapshot {
  query: Query;
  items: CalendarOccurrenceItem[];
}

interface EventUpdates {
  entries: CalendarUpdate[];
  viewports: Map<string, ViewportSnapshot>;
  confirmedTime?: EventTime;
  revision: number;
  tail: Promise<void>;
  retired?: boolean;
}

export interface CalendarUpdate {
  client: QueryClient;
  args: UpdateCalendarEventArgs;
  state: EventUpdates;
  ready: Promise<void>;
  release: () => void;
  status: 'pending' | 'saved' | 'failed';
}

interface UpdateRegistry {
  revision: number;
  events: Map<string, EventUpdates>;
}

// Query-client ownership prevents a retired account's writes from projecting
// into a replacement client's cache. Snapshots also retain the exact query.
const REGISTRIES = new WeakMap<QueryClient, UpdateRegistry>();
const SUBMISSIONS = new WeakMap<UpdateCalendarEventArgs, CalendarUpdate[]>();

function registry(client: QueryClient): UpdateRegistry {
  let value = REGISTRIES.get(client);
  if (!value) {
    const created: UpdateRegistry = { revision: 0, events: new Map() };
    value = created;
    REGISTRIES.set(client, created);
    client.getQueryCache().subscribe((event) => {
      if (event.type !== 'removed') return;
      for (const [id, state] of created.events) {
        if (state.viewports.get(event.query.queryHash)?.query !== event.query)
          continue;
        state.viewports.delete(event.query.queryHash);
        if (state.viewports.size === 0) {
          state.retired = true;
          created.events.delete(id);
        }
      }
    });
  }
  return value;
}

function copyPatch<
  T extends Pick<
    CalendarEvent,
    'title' | 'description' | 'location' | 'reminders'
  >,
>(value: T, patch: Patch): T {
  return {
    ...value,
    ...(patch.title != null ? { title: patch.title } : {}),
    ...(patch.description !== undefined
      ? { description: patch.description }
      : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.reminders != null ? { reminders: patch.reminders } : {}),
  };
}

export function applyEventPatch(
  item: CalendarOccurrenceItem,
  args: UpdateCalendarEventArgs
): CalendarOccurrenceItem {
  const { patch } = args;
  const sources = item.event.sources ?? [];
  const calendarId = args.calendarId ?? sources[0]?.calendarId;
  const canonical =
    sources.length === 0 || calendarId === sources[0]?.calendarId;
  let next = item;
  if (patch.time) {
    next =
      args.scope === 'this_event'
        ? { ...item, occurrence: { ...item.occurrence, time: patch.time } }
        : projectCalendarOccurrenceTime(item, patch.time);
  }
  return {
    ...next,
    event: {
      ...(canonical ? copyPatch(next.event, patch) : next.event),
      ...(canonical && patch.guestPolicy
        ? { guestPolicy: patch.guestPolicy }
        : {}),
      ...(patch.recurrenceLines
        ? { recurrenceLines: patch.recurrenceLines }
        : {}),
      ...(sources.length
        ? {
            sources: sources.map((source) =>
              source.calendarId === calendarId
                ? copyPatch(source, patch)
                : source
            ),
          }
        : {}),
    },
  };
}

function targets(item: CalendarOccurrenceItem, args: UpdateCalendarEventArgs) {
  return (
    args.scope !== 'this_event' ||
    item.occurrence.occurrenceKey === (args.occurrenceKey ?? args.recurrenceId)
  );
}

/** Merge only fields owned by these writes; RSVP and other concurrent data survive. */
function mergeProjection(
  current: CalendarOccurrenceItem,
  projected: CalendarOccurrenceItem,
  entries: CalendarUpdate[]
): CalendarOccurrenceItem {
  let next = current;
  for (const { args } of entries) {
    if (!targets(projected, args)) continue;
    const { patch } = args;
    const source = projected.event.sources?.find(
      (copy) => copy.calendarId === args.calendarId
    );
    const content = source ?? projected.event;
    next = applyEventPatch(next, {
      ...args,
      patch: {
        ...(patch.title != null ? { title: content.title } : {}),
        ...(patch.description !== undefined
          ? { description: content.description }
          : {}),
        ...(patch.location !== undefined ? { location: content.location } : {}),
        ...(patch.reminders != null ? { reminders: content.reminders } : {}),
        ...(patch.guestPolicy
          ? { guestPolicy: projected.event.guestPolicy }
          : {}),
        ...(patch.recurrenceLines
          ? { recurrenceLines: projected.event.recurrenceLines }
          : {}),
      },
    });
    if (patch.time) {
      next = {
        ...next,
        event: { ...next.event, time: projected.event.time },
        occurrence: {
          ...next.occurrence,
          time: projected.occurrence.time,
          recurrenceId: projected.occurrence.recurrenceId,
        },
      };
    }
  }
  return next;
}

function project(
  items: CalendarOccurrenceItem[],
  state: EventUpdates,
  snapshot: ViewportSnapshot
) {
  return items.map((current) => {
    const base = snapshot.items.find(
      (item) =>
        item.occurrence.occurrenceKey === current.occurrence.occurrenceKey &&
        item.event.id === current.event.id
    );
    if (!base) return current;
    let projected = base;
    for (const entry of state.entries) {
      if (entry.status !== 'failed' && targets(base, entry.args)) {
        projected = applyEventPatch(projected, entry.args);
      }
    }
    return mergeProjection(current, projected, state.entries);
  });
}

function publish(client: QueryClient, state: EventUpdates) {
  for (const [key, snapshot] of state.viewports) {
    const current = client.getQueryCache().get(key);
    if (current !== snapshot.query) continue;
    client.setQueryData<CalendarOccurrencesData>(current.queryKey, (data) =>
      data ? { ...data, items: project(data.items, state, snapshot) } : data
    );
  }
}

export function beginCalendarUpdate(
  client: QueryClient,
  args: UpdateCalendarEventArgs
): CalendarUpdate {
  const owner = registry(client);
  let state = owner.events.get(args.eventId);
  if (!state) {
    state = {
      entries: [],
      viewports: new Map(),
      revision: 0,
      tail: Promise.resolve(),
    };
    owner.events.set(args.eventId, state);
  }
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: calendarKeys.occurrences._def })) {
    const data = client.getQueryData<CalendarOccurrencesData>(query.queryKey);
    if (!data || state.viewports.has(query.queryHash)) continue;
    const items = data.items.filter((item) => item.event.id === args.eventId);
    if (!items.length) continue;
    state.viewports.set(query.queryHash, { query, items });
    state.confirmedTime ??= items[0].event.time;
  }
  const ready = state.tail;
  let release = () => {};
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entry: CalendarUpdate = {
    client,
    args,
    state,
    ready,
    release,
    status: 'pending',
  };
  state.entries.push(entry);
  state.revision = ++owner.revision;
  const submissions = SUBMISSIONS.get(args) ?? [];
  submissions.push(entry);
  SUBMISSIONS.set(args, submissions);
  return entry;
}

export async function installCalendarUpdate(
  client: QueryClient,
  entry: CalendarUpdate
) {
  await client.cancelQueries({ queryKey: calendarKeys.occurrences._def });
  publish(client, entry.state);
  entry.args.onOptimistic?.();
}

/** Wait for the previous write's terminal result, not merely durable enqueue. */
export async function prepareCalendarUpdate(args: UpdateCalendarEventArgs) {
  const submissions = SUBMISSIONS.get(args);
  const entry = submissions?.shift();
  if (submissions?.length === 0) SUBMISSIONS.delete(args);
  if (!entry) return args;
  await entry.ready;
  if (entry.state.retired)
    throw new Error('Calendar account changed before saving');
  if (args.scope !== 'this_event') return args;
  const key = args.occurrenceKey ?? args.recurrenceId;
  const base = [...entry.state.viewports.values()]
    .flatMap((snapshot) => snapshot.items)
    .find((item) => item.occurrence.occurrenceKey === key);
  if (!base || !entry.state.confirmedTime) return args;
  const projected = projectCalendarOccurrenceTime(
    base,
    entry.state.confirmedTime
  );
  return {
    ...args,
    recurrenceId:
      projected.occurrence.recurrenceId ?? projected.occurrence.occurrenceKey,
    occurrenceKey:
      projected.occurrence.recurrenceId ?? projected.occurrence.occurrenceKey,
  };
}

export function settleCalendarUpdate(
  client: QueryClient,
  entry: CalendarUpdate,
  saved: boolean
) {
  entry.status = saved ? 'saved' : 'failed';
  if (saved && entry.args.scope !== 'this_event' && entry.args.patch.time) {
    entry.state.confirmedTime = entry.args.patch.time;
  }
  entry.state.revision = ++registry(client).revision;
  if (!entry.state.retired) publish(client, entry.state);
  entry.release();
}

export function calendarUpdateReadRevision(client: QueryClient): number {
  return registry(client).revision;
}

function sameTime(left: EventTime, right: EventTime) {
  if (left.kind === 'timed' && right.kind === 'timed') {
    return (
      Date.parse(left.startsAt) === Date.parse(right.startsAt) &&
      Date.parse(left.endsAt) === Date.parse(right.endsAt)
    );
  }
  return (
    left.kind === 'allDay' &&
    right.kind === 'allDay' &&
    left.startDate === right.startDate &&
    left.endDate === right.endDate
  );
}

function inRange(time: EventTime, range?: CalendarOccurrenceQueryRange) {
  if (!range) return true;
  if (time.kind === 'allDay')
    return time.startDate < range.endDate && time.endDate > range.startDate;
  return (
    Date.parse(time.startsAt) < Date.parse(range.end) &&
    Date.parse(time.endsAt) > Date.parse(range.start)
  );
}

function occurrenceAddress(item: CalendarOccurrenceItem) {
  if (item.occurrence.recurrenceId) return item.occurrence.recurrenceId;
  const time = item.occurrence.time;
  return time.kind === 'timed' ? time.startsAt : time.startDate;
}

function sameOccurrence(
  left: CalendarOccurrenceItem,
  right: CalendarOccurrenceItem
) {
  if (left.event.id !== right.event.id) return false;
  const leftKey = occurrenceAddress(left);
  const rightKey = occurrenceAddress(right);
  return (
    leftKey === rightKey ||
    (Number.isFinite(Date.parse(leftKey)) &&
      Date.parse(leftKey) === Date.parse(rightKey))
  );
}

function confirmsPatch(
  actual: CalendarOccurrenceItem,
  expected: CalendarOccurrenceItem,
  args: UpdateCalendarEventArgs
) {
  const { patch } = args;
  const expectedCopy =
    expected.event.sources?.find(
      (copy) => copy.calendarId === args.calendarId
    ) ?? expected.event;
  const actualCopy =
    actual.event.sources?.find((copy) => copy.calendarId === args.calendarId) ??
    actual.event;
  if (patch.title != null && actualCopy.title !== expectedCopy.title)
    return false;
  if (
    patch.description !== undefined &&
    actualCopy.description !== expectedCopy.description
  )
    return false;
  if (
    patch.location !== undefined &&
    actualCopy.location !== expectedCopy.location
  )
    return false;
  if (
    patch.reminders != null &&
    !deepEqual(actualCopy.reminders, expectedCopy.reminders)
  )
    return false;
  if (
    patch.guestPolicy &&
    !deepEqual(actual.event.guestPolicy, expected.event.guestPolicy)
  )
    return false;
  if (
    patch.recurrenceLines &&
    !deepEqual(actual.event.recurrenceLines, expected.event.recurrenceLines)
  )
    return false;
  if (patch.time && !sameTime(actual.occurrence.time, expected.occurrence.time))
    return false;
  return (
    !patch.time ||
    args.scope === 'this_event' ||
    sameTime(actual.event.time, expected.event.time)
  );
}

function readConfirmsUpdates(
  data: CalendarOccurrencesData,
  state: EventUpdates,
  snapshot: ViewportSnapshot,
  range?: CalendarOccurrenceQueryRange
) {
  const expected = project(snapshot.items, state, snapshot);
  return expected.every((item) => {
    if (item.occurrence.isCancelled || !inRange(item.occurrence.time, range))
      return true;
    const writes = state.entries.filter(
      (entry) => entry.status === 'saved' && targets(item, entry.args)
    );
    if (writes.length === 0) return true;
    const actual = data.items.find((candidate) =>
      sameOccurrence(candidate, item)
    );
    return (
      actual !== undefined &&
      writes.every((entry) => confirmsPatch(actual, item, entry.args))
    );
  });
}

/** Keep projected event fields through stale reads; release them on a fresh complete read. */
export function reconcileCalendarUpdateRead(
  client: QueryClient,
  queryKey: readonly unknown[],
  data: CalendarOccurrencesData,
  revision: number,
  range?: CalendarOccurrenceQueryRange
): CalendarOccurrencesData {
  const owner = registry(client);
  const key = hashKey(queryKey);
  let items = data.items;
  for (const [eventId, state] of owner.events) {
    const snapshot = state.viewports.get(key);
    if (!snapshot) continue;
    const pending = state.entries.some((entry) => entry.status === 'pending');
    if (
      !pending &&
      !data.partial &&
      revision >= state.revision &&
      readConfirmsUpdates(data, state, snapshot, range)
    ) {
      state.viewports.delete(key);
      if (state.viewports.size === 0) owner.events.delete(eventId);
      continue;
    }
    // A series move can replace all occurrence keys. Retain this viewport's
    // known instances until its post-write read, rather than dropping the edit.
    const otherEvents = items.filter((item) => item.event.id !== eventId);
    const current = snapshot.items.map(
      (item) =>
        items.find(
          (next) =>
            next.event.id === eventId &&
            next.occurrence.occurrenceKey === item.occurrence.occurrenceKey
        ) ?? item
    );
    items = [...otherEvents, ...project(current, state, snapshot)];
  }
  return { ...data, items };
}
