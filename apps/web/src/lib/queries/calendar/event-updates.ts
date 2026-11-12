import { deepEqual } from '@core/util/compareUtils';
import { captureCacheWriteSession } from '@graphql-cache/session-writes';
import type { CalendarEvent } from '@service-storage/generated/schemas/calendarEvent';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { EventTime } from '@service-storage/generated/schemas/eventTime';
import { hashKey, type Query, type QueryClient } from '@tanstack/solid-query';
import { type Accessor, createSignal } from 'solid-js';
import { type CalendarOccurrenceQueryRange, calendarKeys } from './keys';
import type { UpdateCalendarEventArgs } from './mutations';
import type { CalendarOccurrencesData } from './occurrences';
import { projectCalendarOccurrenceTime } from './optimistic-time';

type Patch = UpdateCalendarEventArgs['patch'];

interface ViewportSnapshot {
  query: Query;
  items: CalendarOccurrenceItem[];
  range?: CalendarOccurrenceQueryRange;
}

interface EventUpdates {
  entries: CalendarUpdate[];
  viewports: Map<string, ViewportSnapshot>;
  confirmedTime?: EventTime;
  timeBasis?: UpdateCalendarEventArgs['timeBasis'];
  revision: number;
  awaitingRefresh: boolean;
  tail: Promise<void>;
  isCurrent: () => boolean;
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
  changed: Accessor<undefined>;
  notify: () => void;
}

// Query-client ownership prevents a retired account's writes from projecting
// into a replacement client's cache. Snapshots also retain the exact query.
const REGISTRIES = new WeakMap<QueryClient, UpdateRegistry>();
const SUBMISSIONS = new WeakMap<UpdateCalendarEventArgs, CalendarUpdate[]>();

function registry(client: QueryClient): UpdateRegistry {
  let value = REGISTRIES.get(client);
  if (!value) {
    const [changed, notify] = createSignal(undefined, { equals: false });
    const created: UpdateRegistry = {
      revision: 0,
      events: new Map(),
      changed,
      notify,
    };
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
        created.notify();
      }
    });
  }
  return value;
}

/** Reactive status shared by every occurrence and editor of one event. */
export function isCalendarEventUpdating(client: QueryClient, eventId: string) {
  const owner = registry(client);
  owner.changed();
  const state = owner.events.get(eventId);
  return Boolean(
    state?.isCurrent() &&
      !state.retired &&
      (state.awaitingRefresh ||
        state.entries.some((entry) => entry.status === 'pending'))
  );
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
      data
        ? { ...data, items: applySnapshot(data.items, state, snapshot) }
        : data
    );
  }
}

function occurrenceVersions(base: CalendarOccurrenceItem, state: EventUpdates) {
  const versions = [base];
  let current = base;
  for (const entry of state.entries) {
    // Failed versions still identify cache records that must be replaced by
    // rollback; only project() decides which writes remain visible.
    if (!targets(base, entry.args)) continue;
    current = applyEventPatch(current, entry.args);
    versions.push(current);
  }
  return versions;
}

function applySnapshot(
  items: CalendarOccurrenceItem[],
  state: EventUpdates,
  snapshot: ViewportSnapshot
) {
  // Replace all known versions of an occurrence, including stale membership,
  // but keep unrelated or genuinely unseen provider records.
  const versions = snapshot.items.flatMap((base) =>
    occurrenceVersions(base, state)
  );
  const unknown = items.filter(
    (item) => !versions.some((version) => sameOccurrence(item, version))
  );
  const current = snapshot.items.map((item) => {
    const versions = occurrenceVersions(item, state);
    const observed =
      items.find(
        (next) =>
          next.event.id === item.event.id &&
          next.occurrence.occurrenceKey === item.occurrence.occurrenceKey
      ) ??
      items.find((next) =>
        versions.some((version) => sameOccurrence(next, version))
      );
    if (!observed) return item;
    return {
      ...observed,
      occurrence: {
        ...observed.occurrence,
        occurrenceKey: item.occurrence.occurrenceKey,
      },
    };
  });
  const projected = project(current, state, snapshot).filter((item) =>
    inRange(item.occurrence.time, snapshot.range)
  );
  return [...unknown, ...projected];
}

function knownSnapshot(
  state: EventUpdates,
  query: Query,
  data: CalendarOccurrencesData,
  range?: CalendarOccurrenceQueryRange
): ViewportSnapshot | undefined {
  const originals = new Map<string, CalendarOccurrenceItem>();
  for (const snapshot of state.viewports.values()) {
    for (const item of snapshot.items)
      originals.set(item.occurrence.occurrenceKey, item);
  }
  const basis = state.timeBasis;
  if (basis && !originals.has(basis.occurrence.occurrenceKey)) {
    for (const observed of data.items) {
      if (observed.event.id !== state.entries[0]?.args.eventId) continue;
      const original = {
        ...observed,
        event: {
          ...observed.event,
          time: basis.seriesTime,
          recurrenceLines: basis.recurrenceLines,
        },
        occurrence: { ...observed.occurrence, ...basis.occurrence },
      };
      if (
        occurrenceVersions(original, state).some((version) =>
          sameOccurrence(version, observed)
        )
      ) {
        originals.set(basis.occurrence.occurrenceKey, original);
        break;
      }
    }
  }
  const items = [...originals.values()];
  const included = items.filter((item) =>
    occurrenceVersions(item, state).some((version) =>
      inRange(version.occurrence.time, range)
    )
  );
  return included.length ? { query, items: included, range } : undefined;
}

function snapshotRange(query: Query): CalendarOccurrenceQueryRange | undefined {
  // calendarKeys.occurrences stores the range after namespace, name, and user.
  const range = query.queryKey[3];
  if (
    typeof range !== 'object' ||
    range === null ||
    !('start' in range) ||
    typeof range.start !== 'string' ||
    !('end' in range) ||
    typeof range.end !== 'string' ||
    !('startDate' in range) ||
    typeof range.startDate !== 'string' ||
    !('endDate' in range) ||
    typeof range.endDate !== 'string'
  )
    return;
  return {
    start: range.start,
    end: range.end,
    startDate: range.startDate,
    endDate: range.endDate,
  };
}

export function beginCalendarUpdate(
  client: QueryClient,
  args: UpdateCalendarEventArgs
): CalendarUpdate {
  const owner = registry(client);
  let state = owner.events.get(args.eventId);
  if (state && !state.isCurrent()) {
    state.retired = true;
    owner.events.delete(args.eventId);
    state = undefined;
  }
  if (!state) {
    state = {
      isCurrent: captureCacheWriteSession().isCurrent,
      timeBasis: args.timeBasis,
      confirmedTime: args.timeBasis?.seriesTime,
      entries: [],
      viewports: new Map(),
      revision: 0,
      tail: Promise.resolve(),
      awaitingRefresh: false,
    };
    owner.events.set(args.eventId, state);
  }
  const existingTimeChange = state.entries.some(
    (entry) => entry.status !== 'failed' && entry.args.patch.time
  );
  if (existingTimeChange && (args.patch.time || args.scope === 'this_event')) {
    const key = args.timeBasis?.occurrence.occurrenceKey ?? args.occurrenceKey;
    const known =
      key &&
      (state.timeBasis?.occurrence.occurrenceKey === key ||
        [...state.viewports.values()].some((snapshot) =>
          snapshot.items.some((item) => item.occurrence.occurrenceKey === key)
        ));
    if (!known && (key !== undefined || args.scope === 'this_event')) {
      throw new Error('Refresh this occurrence before editing its time.');
    }
  }
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: calendarKeys.occurrences._def })) {
    const data = client.getQueryData<CalendarOccurrencesData>(query.queryKey);
    if (!data || state.viewports.has(query.queryHash)) continue;
    const items = data.items.filter((item) => item.event.id === args.eventId);
    if (!items.length || state.entries.length > 0) continue;
    state.confirmedTime ??= items[0].event.time;
    state.viewports.set(query.queryHash, {
      query,
      items,
      range: snapshotRange(query),
    });
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
  owner.notify();
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
  if (!entry.state.isCurrent()) {
    entry.state.retired = true;
    return;
  }
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
  if (entry.state.retired || !entry.state.isCurrent()) {
    entry.state.retired = true;
    throw new Error('Calendar account changed before saving');
  }
  if (args.scope !== 'this_event') return args;
  const key = args.occurrenceKey ?? args.recurrenceId;
  const basis = entry.state.timeBasis;
  const base =
    [...entry.state.viewports.values()]
      .flatMap((snapshot) => snapshot.items)
      .find((item) => item.occurrence.occurrenceKey === key) ??
    (basis && basis.occurrence.occurrenceKey === key
      ? {
          event: {
            time: basis.seriesTime,
            recurrenceLines: basis.recurrenceLines,
          },
          occurrence: basis.occurrence,
        }
      : undefined);
  if (!base || !entry.state.confirmedTime) {
    const changedSeries = entry.state.entries.some(
      (other) =>
        other !== entry &&
        other.status === 'saved' &&
        other.args.scope !== 'this_event' &&
        other.args.patch.time
    );
    if (changedSeries)
      throw new Error('Refresh this occurrence before editing it.');
    return args;
  }
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
  if (saved) entry.state.awaitingRefresh = entry.state.viewports.size > 0;
  entry.state.revision = ++registry(client).revision;
  if (!entry.state.retired && entry.state.isCurrent())
    publish(client, entry.state);
  registry(client).notify();
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
  return expected.every((item, index) => {
    if (item.occurrence.isCancelled) return true;
    if (!inRange(item.occurrence.time, range)) {
      const versions = occurrenceVersions(snapshot.items[index], state);
      return !data.items.some(
        (actual) =>
          inRange(actual.occurrence.time, range) &&
          versions.some((version) => sameOccurrence(actual, version))
      );
    }
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
    if (!state.isCurrent()) {
      state.retired = true;
      owner.events.delete(eventId);
      owner.notify();
      continue;
    }
    const pending = state.entries.some((entry) => entry.status === 'pending');
    let snapshot = state.viewports.get(key);
    if (!snapshot) {
      const query = client.getQueryCache().get(key);
      if (query) {
        snapshot = knownSnapshot(state, query, data, range);
        if (snapshot) state.viewports.set(key, snapshot);
      }
    }
    if (!snapshot) continue;
    if (
      !pending &&
      !data.partial &&
      revision >= state.revision &&
      readConfirmsUpdates(data, state, snapshot, range)
    ) {
      state.awaitingRefresh = false;
      owner.notify();
      state.viewports.delete(key);
      if (state.viewports.size === 0) owner.events.delete(eventId);
      continue;
    }
    items = applySnapshot(items, state, snapshot);
  }
  return { ...data, items };
}
