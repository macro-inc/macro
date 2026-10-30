import {
  type CacheHost,
  type CalendarLinkWatermarkWire,
  type CalendarRangeCacheArgs,
  type CalendarRangeCacheResult,
  type CalendarSpanWire,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import {
  CalendarOccurrenceItemFieldsFragmentDoc,
  CalendarOccurrencesDocument,
  type CalendarOccurrencesQuery,
  type CalendarRangeInput,
} from '@service-storage/graphql/generated/graphql';
import { ResultAsync } from 'neverthrow';
import type { CalendarOccurrenceQueryRange } from '../keys';
import type { CalendarOccurrencesData } from '../occurrences';
import { mapCalendarOccurrence, mapCalendarSyncStatus } from './map';
import { fetchCached } from './network';
import {
  CALENDAR_CACHE_HEAD_START_MS,
  calendarCacheAnswered,
  markCalendarCacheAnswered,
  withinCacheHeadStart,
} from './readiness';

const MS_PER_DAY = 86_400_000;
const OCCURRENCE_PAGE_SIZE = 2000;

export type CalendarOccurrencePage =
  CalendarOccurrencesQuery['user']['calendarOccurrences'];

/** Fetches one occurrence page and resolves once it is written to the cache. */
export type FetchCalendarOccurrencePage = (
  input: CalendarRangeInput,
  signal?: AbortSignal
) => Promise<CalendarOccurrencePage>;

/** One server fetch and the coverage it proves for both span kinds. */
export interface CalendarFetchWindow {
  input: Pick<CalendarRangeInput, 'start' | 'end' | 'startDate' | 'endDate'>;
  coverage: CalendarSpanWire[];
}

let latestSyncStatus: CalendarSyncStatus = CalendarSyncStatus.ready;
let startedSyncStatusSamples = 0;
let recordedSyncStatusSample = 0;

/** The last ingestion state the server reported; ready until a page says otherwise. */
export function latestCalendarSyncStatus(): CalendarSyncStatus {
  return latestSyncStatus;
}

/**
 * Starts sampling the viewer-wide sync status. Requests can finish out of
 * order, so a status records only if no later-started sample already did.
 */
export function beginCalendarSyncStatusSample(): number {
  startedSyncStatusSamples += 1;
  return startedSyncStatusSamples;
}

/** Records a sampled status; returns false when a newer sample superseded it. */
export function recordCalendarSyncStatus(
  status: CalendarSyncStatus,
  sample: number
): boolean {
  if (sample < recordedSyncStatusSample) return false;
  recordedSyncStatusSample = sample;
  latestSyncStatus = status;
  return true;
}

const pad = (value: number) => String(value).padStart(2, '0');

const formatLocalDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Days since 1970-01-01 of a `YYYY-MM-DD` calendar date. */
export function epochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / MS_PER_DAY;
}

/** The `YYYY-MM-DD` calendar date of an epoch day. */
export function epochDayDate(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

const localMidnight = (day: number): number => {
  const [year, month, date] = epochDayDate(day).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).getTime();
};

/** The first local date at or after an instant. */
const localDateCeil = (ms: number): string => {
  const date = new Date(ms);
  const floor = formatLocalDate(date);
  return localMidnight(epochDay(floor)) === ms
    ? floor
    : epochDayDate(epochDay(floor) + 1);
};

export function toCalendarRangeArgs(
  range: CalendarOccurrenceQueryRange,
  eventKey?: string
): CalendarRangeCacheArgs {
  return {
    startMs: Date.parse(range.start),
    endMs: Date.parse(range.end),
    startDay: epochDay(range.startDate),
    endDay: epochDay(range.endDate),
    ...(eventKey ? { eventKey } : {}),
  };
}

/**
 * Turns uncovered spans into server fetches. A timed gap fetches its local
 * dates too; an all-day gap no timed fetch already spans fetches its own
 * local midnights. Each window proves coverage of everything it fetched.
 */
export function calendarGapWindows(
  gaps: readonly CalendarSpanWire[]
): CalendarFetchWindow[] {
  const windows: CalendarFetchWindow[] = [];
  for (const gap of gaps) {
    if (gap.kind !== 'timed') continue;
    const startDate = formatLocalDate(new Date(gap.start));
    const endDate = localDateCeil(gap.end);
    windows.push({
      input: {
        start: new Date(gap.start).toISOString(),
        end: new Date(gap.end).toISOString(),
        startDate,
        endDate,
      },
      coverage: [
        { kind: 'timed', start: gap.start, end: gap.end },
        { kind: 'allDay', start: epochDay(startDate), end: epochDay(endDate) },
      ],
    });
  }
  const fetchedDays = windows.map((window) => window.coverage[1]);
  for (const gap of gaps) {
    if (gap.kind !== 'allDay') continue;
    if (
      fetchedDays.some(
        (days) => days && days.start <= gap.start && days.end >= gap.end
      )
    ) {
      continue;
    }
    const start = localMidnight(gap.start);
    const end = localMidnight(gap.end);
    windows.push({
      input: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        startDate: epochDayDate(gap.start),
        endDate: epochDayDate(gap.end),
      },
      coverage: [
        { kind: 'timed', start, end },
        { kind: 'allDay', start: gap.start, end: gap.end },
      ],
    });
  }
  return windows;
}

/** Per-link minimum: a page can only vouch for changes all of its reads saw. */
export function lowestWatermark(
  pages: ReadonlyArray<readonly CalendarLinkWatermarkWire[]>
): CalendarLinkWatermarkWire[] {
  const lowest = new Map<string, bigint>();
  for (const page of pages) {
    for (const { linkId, seq } of page) {
      const value = BigInt(seq);
      const current = lowest.get(linkId);
      if (current === undefined || value < current) lowest.set(linkId, value);
    }
  }
  return [...lowest].map(([linkId, seq]) => ({ linkId, seq: String(seq) }));
}

/** Foreground page fetches written like any query response. */
export const fetchCalendarOccurrencePage: FetchCalendarOccurrencePage = async (
  input,
  signal
) =>
  (await fetchCached(CalendarOccurrencesDocument, { input }, { signal })).user
    .calendarOccurrences;

/** Background page fetches that hydrate without re-executing foreground queries. */
export const hydrateCalendarOccurrencePage: FetchCalendarOccurrencePage =
  async (input, signal) =>
    (
      await fetchCached(
        CalendarOccurrencesDocument,
        { input },
        { hydrateOnly: true, signal }
      )
    ).user.calendarOccurrences;

/**
 * Fetches every page of one window and commits its coverage with the lowest
 * watermark any page captured, so later deltas replay what a page predates.
 */
export async function fetchCalendarWindow(
  host: Pick<CacheHost, 'calendarCommit'>,
  window: CalendarFetchWindow,
  fetchPage: FetchCalendarOccurrencePage,
  signal?: AbortSignal
): Promise<void> {
  const watermarks: CalendarLinkWatermarkWire[][] = [];
  const sample = beginCalendarSyncStatusSample();
  let syncStatus: CalendarSyncStatus = CalendarSyncStatus.ready;
  let after: string | undefined;
  const seenCursors = new Set<string>();
  for (;;) {
    const page = await fetchPage(
      {
        ...window.input,
        first: OCCURRENCE_PAGE_SIZE,
        ...(after ? { after } : {}),
      },
      signal
    );
    watermarks.push(page.watermark);
    if (mapCalendarSyncStatus(page.syncStatus) === CalendarSyncStatus.syncing) {
      syncStatus = CalendarSyncStatus.syncing;
    }
    if (!page.hasNextPage) break;
    if (!page.endCursor || seenCursors.has(page.endCursor)) {
      throw new Error(
        'Calendar occurrence pagination returned an invalid cursor'
      );
    }
    seenCursors.add(page.endCursor);
    after = page.endCursor;
  }
  recordCalendarSyncStatus(syncStatus, sample);
  await host.calendarCommit({
    coverage: window.coverage,
    watermark: { kind: 'merge', links: lowestWatermark(watermarks) },
  });
}

const occurrenceSelection = selectRecords(
  CalendarOccurrenceItemFieldsFragmentDoc
);

/**
 * Reads the occurrences behind range keys. A key whose record lacks a field
 * the selection asks for, such as one cached by a build with fewer fields,
 * comes back unreadable rather than as an item.
 */
async function readOccurrenceItems(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  keys: readonly string[]
) {
  const items = [];
  const unreadable: string[] = [];
  for (
    let index = 0;
    index < keys.length;
    index += MAX_RECORD_SELECTION_PAGE_SIZE
  ) {
    const batch = keys.slice(index, index + MAX_RECORD_SELECTION_PAGE_SIZE);
    const { records } = await readRecordsByKeys(
      host,
      occurrenceSelection,
      batch
    );
    const read = new Set<string>();
    for (const { recordKey, record } of records) {
      read.add(recordKey);
      items.push(mapCalendarOccurrence(record));
    }
    for (const key of batch) if (!read.has(key)) unreadable.push(key);
  }
  return { items, unreadable };
}

// Unreadable keys each host already refetched, so a row the server no longer
// returns costs one request per session rather than one per read.
const refetchedUnreadable = new WeakMap<object, Set<string>>();

function claimUnreadable(host: object, keys: readonly string[]): string[] {
  let claimed = refetchedUnreadable.get(host);
  if (!claimed) {
    claimed = new Set();
    refetchedUnreadable.set(host, claimed);
  }
  const fresh = keys.filter((key) => !claimed.has(key));
  for (const key of fresh) claimed.add(key);
  return fresh;
}

function releaseUnreadable(host: object, keys: readonly string[]): void {
  const claimed = refetchedUnreadable.get(host);
  for (const key of keys) claimed?.delete(key);
}

async function fetchViewport(
  host: Pick<CacheHost, 'calendarCommit'>,
  args: CalendarRangeCacheArgs,
  fetchPage: FetchCalendarOccurrencePage,
  signal?: AbortSignal
): Promise<void> {
  for (const window of calendarGapWindows([
    { kind: 'timed', start: args.startMs, end: args.endMs },
    { kind: 'allDay', start: args.startDay, end: args.endDay },
  ])) {
    await fetchCalendarWindow(host, window, fetchPage, signal);
  }
}

/**
 * Reads a covered viewport's occurrences. When the current build cannot read
 * some of them, the viewport is refetched once, rewriting them with every
 * field it selects, as any cache miss goes to the network. A failed refetch
 * answers with what was readable, as the viewport does offline.
 */
async function readViewportItems(
  host: Pick<
    CacheHost,
    'calendarRange' | 'calendarCommit' | 'readRecordsByKeys'
  >,
  args: CalendarRangeCacheArgs,
  occurrenceKeys: readonly string[],
  fetchPage: FetchCalendarOccurrencePage,
  signal?: AbortSignal
): Promise<CalendarOccurrencesData['items'] | 'unsupported'> {
  const read = await readOccurrenceItems(host, occurrenceKeys);
  const unreadable = claimUnreadable(host, read.unreadable);
  if (unreadable.length === 0) return read.items;
  return Telemetry.span(
    'calendar.refetch_unreadable_occurrences',
    async (span) => {
      span.setAttr('calendar.cache.unreadable_count', unreadable.length);
      const fetched = await ResultAsync.fromPromise(
        fetchViewport(host, args, fetchPage, signal),
        (error) => error
      );
      if (fetched.isErr()) {
        // A later read retries what this one could not refetch.
        releaseUnreadable(host, unreadable);
        if (signal?.aborted) throw fetched.error;
        span.setAttr('calendar.cache.refetch_outcome', 'failed');
        span.error('Refetching unreadable calendar occurrences failed');
        return read.items;
      }
      const result = await host.calendarRange(args);
      if (result.kind === 'unsupported') return 'unsupported';
      const reread = await readOccurrenceItems(host, result.occurrenceKeys);
      span.setAttr('calendar.cache.refetch_outcome', 'refetched');
      span.setAttr(
        'calendar.cache.still_unreadable_count',
        reread.unreadable.length
      );
      return reread.items;
    }
  );
}

// The outstanding first read of each host that has not answered yet.
const firstReads = new WeakMap<object, Promise<unknown>>();

export type CalendarRangeRead =
  | { kind: 'range'; data: CalendarOccurrencesData }
  | { kind: 'unsupported' }
  | { kind: 'not-ready' };

/**
 * Asks the host for a viewport. A host that has never answered gets a head
 * start; past it, or while an earlier first read is still outstanding, the
 * caller reads from REST instead of waiting on cache startup.
 */
async function askCalendarRange(
  host: Pick<CacheHost, 'calendarRange'>,
  args: CalendarRangeCacheArgs,
  headStartMs: number
): Promise<CalendarRangeCacheResult | 'not-ready'> {
  if (calendarCacheAnswered(host)) return host.calendarRange(args);
  if (firstReads.has(host)) return 'not-ready';
  const answer = (async (): Promise<CalendarRangeCacheResult | 'not-ready'> => {
    try {
      const result = await host.calendarRange(args);
      if (result.kind === 'range') markCalendarCacheAnswered(host);
      return result;
    } catch {
      // A failed first read leaves the host unanswered: this viewport reads
      // REST and the next read asks again.
      return 'not-ready';
    } finally {
      firstReads.delete(host);
    }
  })();
  firstReads.set(host, answer);
  return withinCacheHeadStart(answer, headStartMs);
}

/**
 * Answers a viewport from the cache, fetching only spans never fetched and,
 * once per key, viewports whose cached occurrences cannot be read.
 */
export async function readCalendarRange(
  host: Pick<
    CacheHost,
    'calendarRange' | 'calendarCommit' | 'readRecordsByKeys'
  >,
  range: CalendarOccurrenceQueryRange,
  options: {
    fetchPage?: FetchCalendarOccurrencePage;
    signal?: AbortSignal;
    headStartMs?: number;
  } = {}
): Promise<CalendarRangeRead> {
  const args = toCalendarRangeArgs(range);
  const first = await askCalendarRange(
    host,
    args,
    options.headStartMs ?? CALENDAR_CACHE_HEAD_START_MS
  );
  if (first === 'not-ready') return { kind: 'not-ready' };
  let result = first;
  if (result.kind === 'unsupported') return { kind: 'unsupported' };
  const fetchPage = options.fetchPage ?? fetchCalendarOccurrencePage;
  if (result.gaps.length > 0) {
    for (const window of calendarGapWindows(result.gaps)) {
      await fetchCalendarWindow(host, window, fetchPage, options.signal);
    }
    result = await host.calendarRange(args);
    if (result.kind === 'unsupported') return { kind: 'unsupported' };
  }
  const items = await readViewportItems(
    host,
    args,
    result.occurrenceKeys,
    fetchPage,
    options.signal
  );
  if (items === 'unsupported') return { kind: 'unsupported' };
  return { kind: 'range', data: { items, syncStatus: latestSyncStatus } };
}
