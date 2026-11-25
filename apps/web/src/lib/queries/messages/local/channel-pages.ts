import { fireAndForget } from '@core/util/fireAndForget';
import {
  type CacheHost,
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
  type ChannelCommitArgs,
  type ChannelCoverageWire,
  type ChannelTimelineCacheArgs,
  type RecordSelection,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  type ChannelMessageBaseFieldsFragment,
  ChannelMessageBaseFieldsFragmentDoc,
  ChannelTimelineDocument,
  ChannelTimelineEntryRecordFragmentDoc,
  type ChannelTimelineInput,
  type ChannelTimelineQuery,
} from '@service-storage/graphql/generated/graphql';
import type { MessageTimelineEntry } from '@service-storage/messages';
import { ResultAsync } from 'neverthrow';
import { withinCacheHeadStart } from '../../calendar/graphql/readiness';
import {
  CHANNEL_CACHE_HEAD_START_MS,
  channelCacheAnswered,
  markChannelCacheAnswered,
  markChannelCacheUnsupported,
} from './channel-flag';
import {
  CHANNEL_MESSAGE_TYPENAME,
  type ChannelTimelineRecord,
  channelMessageKey,
  mapChannelTimelineEntry,
} from './channel-map';
import {
  type ChannelAnswer,
  type ChannelQueryOptions,
  type ChannelStoreResult,
  cacheSessionChanged,
  queryChannelNetwork,
  storeResult,
} from './channel-network';

export type ChannelPageHost = Pick<
  CacheHost,
  'channelTimeline' | 'channelTimelineCommit' | 'readRecordsByKeys'
>;

/** One page of a channel's roots; at most one anchor. */
export interface ChannelPageRequest {
  channelId: string;
  limit: number;
  /** Sort key; entries strictly older. */
  before?: string;
  /** Sort key; entries strictly newer. */
  after?: string;
  /** Message to centre the page on; a reply resolves to its root. */
  aroundMessageId?: string;
}

/** One entry of a page with the sort key that places it. */
export interface ChannelPageEntry {
  key: string;
  sortKey: string;
  entry: MessageTimelineEntry;
}

/** Entries newest first, with the sort keys that continue the page. */
export interface ChannelPage {
  entries: ChannelPageEntry[];
  /** Null at the first entry of the channel. */
  olderCursor: string | null;
  /** Null at the live end. */
  newerCursor: string | null;
}

/**
 * Whether the device holds the page now, or the cache session changed before
 * it could store it and the page must be read again.
 */
export type PageStored = 'held' | 'unheld' | 'session-changed';
export type LoadedChannelPage = {
  page: ChannelPage;
  /** How storing the page ended: at once for a device page. Never rejects. */
  stored: Promise<PageStored>;
} & (
  | { source: 'device' }
  | {
      source: 'server';
      /** The sequence the server read the page at. */
      readSeq: string;
    }
);

export type ChannelServerPage = ChannelTimelineQuery['user']['channelTimeline'];

/**
 * Fetches one page; resolves on arrival, before the cache holds it. The cache
 * stores what `commit` makes of the page with the page's records.
 */
export type FetchChannelServerPage = (
  input: ChannelTimelineInput,
  options: ChannelQueryOptions<ChannelServerPage>
) => Promise<{
  page: ChannelServerPage;
  cached: ChannelAnswer<unknown>['cached'];
}>;

/** A store of when each channel was last marked opened. */
export interface ChannelTouches {
  /**
   * The time to record, or undefined when the channel was marked recently in
   * the cache session `generation`, or such a mark is on its way to the
   * device.
   */
  due(channelId: string, nowMs: number, generation: string): number | undefined;
  /**
   * Tells how the commit carrying a mark from `due` ended: one the device did
   * not store is due again at the next read.
   */
  settled(
    channelId: string,
    touchedAtMs: number,
    generation: string,
    stored: boolean
  ): void;
}

/** How often an opened channel's eviction clock is written to the device. */
export const CHANNEL_TOUCH_INTERVAL_MS = 6 * 60 * 60 * 1000;

type SessionGeneration = typeof cacheSessionGeneration;

/**
 * Whether the device takes a mark read under `generation`: the current
 * session, also while its cleanup still runs (the device already writes under
 * it, and a channel opened then would otherwise keep its old clock).
 */
export const touchSessionAccepts =
  (session: Pick<SessionGeneration, 'capture' | 'isCurrent'>) =>
  (generation: string) =>
    generation === session.capture() || session.isCurrent(generation);

/**
 * Remembers in memory when each channel was last marked opened, so ordinary
 * opens write nothing: eviction runs on a 30-day clock, and six hours of
 * slack on it never evicts a channel in use. A mark counts once the device
 * stored it: a channel whose mark was refused (the session changed while it
 * was sent) keeps the device's old clock, which a frame's empty row leaves
 * at 0, and the next eviction would take it while it is on screen. A mark
 * counts only in the cache session it was sent in: the device refuses one
 * from an earlier session, so a read in a new session marks the channel
 * again, even while the earlier mark is still on its way. A read from a
 * session that is no longer current marks nothing, since the device would
 * refuse it, so it never replaces the current session's mark; a read in a
 * session whose cleanup still runs marks.
 */
export function createChannelTouches(
  intervalMs = CHANNEL_TOUCH_INTERVAL_MS,
  isCurrent: (generation: string) => boolean = touchSessionAccepts(
    cacheSessionGeneration
  )
): ChannelTouches {
  const touched = new Map<string, { atMs: number; generation: string }>();
  return {
    due(channelId, nowMs, generation) {
      if (!isCurrent(generation)) return undefined;
      const last = touched.get(channelId);
      const recent =
        last?.generation === generation && nowMs - last.atMs < intervalMs;
      if (recent) return undefined;
      touched.set(channelId, { atMs: nowMs, generation });
      return nowMs;
    },
    settled(channelId, touchedAtMs, generation, stored) {
      const last = touched.get(channelId);
      if (stored || last?.generation !== generation) return;
      if (last.atMs !== touchedAtMs) return;
      touched.delete(channelId);
    },
  };
}

// Compiled on first read: the app shell imports this module before the cache.
let entrySelection: ReturnType<typeof selectRecords> | undefined;
const timelineEntrySelection = () =>
  (entrySelection ??= selectRecords(ChannelTimelineEntryRecordFragmentDoc));

export const fetchChannelServerPage: FetchChannelServerPage = async (
  input,
  { signal, commit }
) => {
  const { data, cached } = await queryChannelNetwork(
    ChannelTimelineDocument,
    { input },
    {
      signal,
      commit: commit && ((data) => commit(data.user.channelTimeline)),
    }
  );
  return { page: data.user.channelTimeline, cached };
};

/** Maps records to page entries, dropping those a timeline does not show. */
export function pageEntries(
  records: readonly ChannelTimelineRecord[]
): ChannelPageEntry[] {
  return records.flatMap((record) => {
    const entry = mapChannelTimelineEntry(record);
    if (!entry) return [];
    return [
      {
        key: `${record.__typename}:${record.id}`,
        sortKey: record.sortKey,
        entry,
      },
    ];
  });
}

/**
 * Reads the records behind page keys in key order. Undefined when a key has
 * no readable record, such as one cached by a build that selected fewer
 * fields.
 */
export async function readTimelineRecords(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  keys: readonly string[]
): Promise<ChannelTimelineRecord[] | undefined> {
  if (keys.length === 0) return [];
  const { records } = await readRecordsByKeys(host, timelineEntrySelection(), [
    ...keys,
  ]);
  const byKey = new Map(
    records.map(({ recordKey, record }) => [
      recordKey,
      record as ChannelTimelineRecord,
    ])
  );
  const ordered: ChannelTimelineRecord[] = [];
  for (const key of keys) {
    const record = byKey.get(key);
    if (!record) return undefined;
    ordered.push(record);
  }
  return ordered;
}

function cacheArgs(request: ChannelPageRequest): ChannelTimelineCacheArgs {
  return {
    channelId: request.channelId,
    limit: request.limit,
    ...(request.before !== undefined && { before: request.before }),
    ...(request.after !== undefined && { after: request.after }),
    ...(request.aroundMessageId !== undefined && {
      around: channelMessageKey(request.aroundMessageId),
    }),
  };
}

export type DeviceRead =
  | { kind: 'page'; page: ChannelPage }
  | { kind: 'miss' }
  | { kind: 'unsupported' }
  // The host failed or timed out; says nothing about what the device holds.
  | { kind: 'failed' };

/** Answers a page from the device: two requests, the index and the records. */
export async function readDeviceChannelPage(
  host: Pick<CacheHost, 'channelTimeline' | 'readRecordsByKeys'>,
  request: ChannelPageRequest
): Promise<DeviceRead> {
  const result = await host.channelTimeline(cacheArgs(request));
  if (result.kind === 'unsupported') return { kind: 'unsupported' };
  if (!result.covered) return { kind: 'miss' };
  const records = await readTimelineRecords(host, result.keys);
  if (!records) return { kind: 'miss' };
  return {
    kind: 'page',
    page: {
      entries: pageEntries(records),
      olderCursor: result.olderCursor,
      newerCursor: result.newerCursor,
    },
  };
}

/**
 * A device read whose failure reads as nothing held: a host that times out
 * under load must send the page to the server, never show an empty channel.
 */
async function readDeviceOrFail(
  host: Pick<CacheHost, 'channelTimeline' | 'readRecordsByKeys'>,
  request: ChannelPageRequest
): Promise<DeviceRead> {
  try {
    return await readDeviceChannelPage(host, request);
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * The stretch a fetched page proves complete: from its oldest entry (or the
 * start of the channel) to its newest (or the live end). Undefined when the
 * page proves nothing, such as an empty window around a message.
 */
export function serverPageCoverage(
  request: Pick<ChannelPageRequest, 'before' | 'after' | 'aroundMessageId'>,
  page: Pick<ChannelServerPage, 'entries' | 'olderCursor' | 'newerCursor'>
): ChannelCoverageWire | undefined {
  const newest = page.entries[0]?.sortKey;
  const oldest = page.entries.at(-1)?.sortKey;
  const start =
    request.after ??
    (page.olderCursor === null ? CHANNEL_TIMELINE_START : oldest);
  const latest =
    request.after === undefined && request.aroundMessageId === undefined;
  const end =
    request.before ??
    (latest || page.newerCursor === null ? CHANNEL_TIMELINE_HEAD : newest);
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

export interface ChannelPageDeps {
  host: ChannelPageHost;
  touches: ChannelTouches;
  fetchPage?: FetchChannelServerPage;
  now?: () => number;
}

/**
 * How long a failed request waits for a device that is still starting before
 * the failure stands: offline, the device is the only place a page can come
 * from.
 */
const FAILED_REQUEST_DEVICE_WAIT_MS = 10_000;

type Fetched =
  | ({ from: 'server' } & Awaited<ReturnType<FetchChannelServerPage>>)
  | { from: 'device'; read: Extract<DeviceRead, { kind: 'page' }> };

/** The server's page; when it fails, a page the starting device holds. */
async function fetchOrDevice(
  server: ReturnType<FetchChannelServerPage>,
  read: Promise<DeviceRead> | undefined
): Promise<Fetched> {
  try {
    return { from: 'server', ...(await server) };
  } catch (error) {
    if (!read) throw error;
    const device = await withinCacheHeadStart(
      read,
      FAILED_REQUEST_DEVICE_WAIT_MS
    );
    if (device === 'not-ready' || device.kind !== 'page') throw error;
    return { from: 'device', read: device };
  }
}

function anchorOf(request: ChannelPageRequest): string {
  if (request.aroundMessageId !== undefined) return 'around';
  if (request.before !== undefined) return 'before';
  if (request.after !== undefined) return 'after';
  return 'latest';
}

/**
 * Marks a channel the device answered as opened, when its clock is due: the
 * one write such an open makes, at most once per channel every six hours. A
 * server page carries the mark in its own commit.
 */
export function touchChannel(
  deps: ChannelPageDeps,
  channelId: string,
  generation: string
): void {
  const touchedAtMs = deps.touches.due(
    channelId,
    (deps.now ?? Date.now)(),
    generation
  );
  if (touchedAtMs === undefined) return;
  const mark = async () => {
    let stored = false;
    try {
      const committed = await deps.host.channelTimelineCommit(
        { channelId, touchedAtMs },
        generation
      );
      stored = committed.kind === 'committed';
    } finally {
      deps.touches.settled(channelId, touchedAtMs, generation, stored);
    }
  };
  fireAndForget(mark(), 'channel-local-sync');
}

/**
 * Loads one page: from the device when it holds the stretch, otherwise from
 * the server, whose page the device then holds. A host that has not
 * answered a channel read yet may still be starting, so it gets a short head
 * start before the server is asked instead. Resolves to `unsupported` when the
 * host cannot serve channels, so the caller reads over REST.
 */
export async function loadChannelPage(
  deps: ChannelPageDeps,
  request: ChannelPageRequest,
  signal?: AbortSignal
): Promise<LoadedChannelPage | 'unsupported'> {
  return Telemetry.span('channel.timeline_page', async (span) => {
    span.setAttr('channel.id', request.channelId);
    span.setAttr('page.limit', request.limit);
    span.setAttr('page.anchor', anchorOf(request));
    return loadPage(deps, request, span, signal);
  });
}

async function loadPage(
  deps: ChannelPageDeps,
  request: ChannelPageRequest,
  span: Span,
  signal?: AbortSignal
): Promise<LoadedChannelPage | 'unsupported'> {
  const host = deps.host;
  // The session the page is read under: a later one must not store it.
  const generation = cacheSessionGeneration.capture();
  const read = readDeviceOrFail(host, request);
  const answered = channelCacheAnswered(host as CacheHost);
  const device = answered
    ? await read
    : await withinCacheHeadStart(read, CHANNEL_CACHE_HEAD_START_MS);
  if (device !== 'not-ready') {
    if (device.kind === 'unsupported') {
      markChannelCacheUnsupported(host as CacheHost);
      span.setAttr('page.source', 'unsupported');
      return 'unsupported';
    }
    if (device.kind !== 'failed') markChannelCacheAnswered(host as CacheHost);
    if (device.kind === 'page') {
      span.setAttr('page.source', 'device');
      span.setAttr('page.entries', device.page.entries.length);
      touchChannel(deps, request.channelId, generation);
      return {
        page: device.page,
        source: 'device',
        stored: Promise.resolve('held'),
      };
    }
  }
  span.setAttr(
    'page.source',
    device === 'not-ready' ? 'server-cold' : 'server'
  );
  const touchedAtMs = deps.touches.due(
    request.channelId,
    (deps.now ?? Date.now)(),
    generation
  );
  const touchSettled = (stored: boolean) => {
    if (touchedAtMs !== undefined)
      deps.touches.settled(request.channelId, touchedAtMs, generation, stored);
  };
  const commit = (page: ChannelServerPage): ChannelCommitArgs => {
    const coverage = serverPageCoverage(request, page);
    return {
      channelId: request.channelId,
      seq: page.seq,
      watermark: { kind: 'lower' },
      ...(coverage && { coverage: [coverage] }),
      ...(touchedAtMs !== undefined && { touchedAtMs }),
    };
  };
  // The device read was awaited: the request joins the page's trace again.
  let fetched: Awaited<ReturnType<typeof fetchOrDevice>>;
  try {
    fetched = await fetchOrDevice(
      span.run(() =>
        (deps.fetchPage ?? fetchChannelServerPage)(
          {
            channelId: request.channelId,
            limit: request.limit,
            before: request.before,
            after: request.after,
            around: request.aroundMessageId,
          },
          { signal, commit }
        )
      ),
      device === 'not-ready' ? read : undefined
    );
  } catch (error) {
    touchSettled(false);
    throw error;
  }
  if (fetched.from === 'device') {
    touchSettled(false);
    span.setAttr('page.source', 'device-offline');
    touchChannel(deps, request.channelId, generation);
    return {
      page: fetched.read.page,
      source: 'device',
      stored: Promise.resolve('held'),
    };
  }
  const { page, cached } = fetched;
  span.setAttr('page.entries', page.entries.length);
  const result = storeResult(cached);
  const store = async (): Promise<ChannelStoreResult> => {
    const stored = await result;
    touchSettled(stored.stored && stored.outcome !== undefined);
    // A cold host only now says whether it serves channels.
    if (device === 'not-ready') {
      const held = await read;
      if (held.kind === 'unsupported')
        markChannelCacheUnsupported(host as CacheHost);
      else if (held.kind !== 'failed')
        markChannelCacheAnswered(host as CacheHost);
    }
    return stored;
  };
  return {
    page: {
      entries: pageEntries(page.entries),
      olderCursor: page.olderCursor,
      newerCursor: page.newerCursor,
    },
    source: 'server',
    readSeq: page.seq,
    // A child of the page's span: the page answers before the device stores it.
    stored: span.span('channel.page.store', async (child) =>
      pageStored(await store(), child)
    ),
  };
}

/** How a store ended. Failures other than a session change are reported here. */
function pageStored(result: ChannelStoreResult, span: Span): PageStored {
  if (result.stored) {
    const stored = typeof result.outcome?.seq === 'string' ? 'held' : 'unheld';
    span.setAttr('page.stored', stored);
    return stored;
  }
  if (cacheSessionChanged(result.error)) {
    span.setAttr('page.stored', 'session-changed');
    return 'session-changed';
  }
  span.setAttr('page.stored', 'failed');
  span.error(result.error);
  Telemetry.error(result.error, { surface: 'channel-local-sync' });
  return 'unheld';
}

// A message's own fields, without its thread and call: a reply the device
// holds only inside its root's thread preview has no more than these.
let ownFieldsSelection:
  | RecordSelection<ChannelMessageBaseFieldsFragment>
  | undefined;
const messageOwnFieldsSelection = () =>
  (ownFieldsSelection ??= selectRecords(ChannelMessageBaseFieldsFragmentDoc));

/**
 * The device's copy of a message's own fields, such as the thread it is in;
 * undefined when the device does not hold it in that channel or cannot be
 * read.
 */
export async function readStoredMessage(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  channelId: string,
  messageId: string
): Promise<ChannelMessageBaseFieldsFragment | undefined> {
  const read = await ResultAsync.fromPromise(
    readRecordsByKeys(host, messageOwnFieldsSelection(), [
      channelMessageKey(messageId),
    ]),
    (error) => error
  );
  if (read.isErr()) {
    Telemetry.error(read.error, { surface: 'channel-local-sync' });
    return undefined;
  }
  const record = read.value.records[0]?.record;
  if (record?.__typename !== CHANNEL_MESSAGE_TYPENAME) return undefined;
  return record.channelId === channelId ? record : undefined;
}

/**
 * The thread the device's copy of a message is in: null for a top-level
 * message, undefined when the device does not hold it in that channel or
 * cannot be read.
 */
export async function readStoredThreadId(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  channelId: string,
  messageId: string
): Promise<string | null | undefined> {
  const message = await readStoredMessage(host, channelId, messageId);
  return message && (message.threadId ?? null);
}
