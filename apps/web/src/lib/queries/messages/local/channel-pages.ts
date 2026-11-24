import { fireAndForget } from '@core/util/fireAndForget';
import {
  type CacheHost,
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
  type ChannelCoverageWire,
  type ChannelTimelineCacheArgs,
  type ChannelTimelineCommitCacheResult,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  ChannelTimelineDocument,
  ChannelTimelineEntryRecordFragmentDoc,
  type ChannelTimelineInput,
  type ChannelTimelineQuery,
} from '@service-storage/graphql/generated/graphql';
import type { MessageTimelineEntry } from '@service-storage/messages';
import { withinCacheHeadStart } from '../../calendar/graphql/readiness';
import {
  CHANNEL_CACHE_HEAD_START_MS,
  channelCacheAnswered,
  markChannelCacheAnswered,
  markChannelCacheUnsupported,
} from './channel-flag';
import {
  type ChannelTimelineRecord,
  channelMessageKey,
  mapChannelTimelineEntry,
} from './channel-map';
import { cacheSessionChanged, queryChannelNetwork } from './channel-network';
import {
  channelResetMark,
  holdAgainstDeletes,
  unchangedSince,
} from './channel-resets';

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
 * What storing a page left on the device: the sequence it holds for the
 * channel (null when it does not hold the page), that the cache session
 * changed first and the page must be read again, or that a delete in some tab
 * came first (`yielded`): the page was shown but not held, and is read again
 * once no delete is pending (`afterDeletes`).
 */
export type PageStored =
  | { kind: 'stored'; seq: string | null }
  | { kind: 'session-changed' }
  | { kind: 'yielded' };
export type LoadedChannelPage = {
  page: ChannelPage;
  /**
   * The change sequence the device holds for the channel once the page is
   * stored: at once for a device page, after the commit for a server page.
   * Never rejects.
   */
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

/** Fetches one page; resolves on arrival, before the cache holds it. */
export type FetchChannelServerPage = (
  input: ChannelTimelineInput,
  signal?: AbortSignal
) => Promise<{ page: ChannelServerPage; cached: Promise<void> }>;

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

/** Commits a page or a mark, and settles the mark it carries. */
async function commitTouch(
  touches: ChannelTouches,
  mark: { channelId: string; touchedAtMs?: number; generation: string },
  commit: () => Promise<ChannelTimelineCommitCacheResult>
): Promise<ChannelTimelineCommitCacheResult> {
  let stored = false;
  try {
    const committed = await commit();
    stored = committed.kind === 'committed';
    return committed;
  } finally {
    const { channelId, touchedAtMs, generation } = mark;
    if (touchedAtMs !== undefined)
      touches.settled(channelId, touchedAtMs, generation, stored);
  }
}

// Compiled on first read: the app shell imports this module before the cache.
let entrySelection: ReturnType<typeof selectRecords> | undefined;
const timelineEntrySelection = () =>
  (entrySelection ??= selectRecords(ChannelTimelineEntryRecordFragmentDoc));

/**
 * Fetches a page over the cached client: the normalized cache writes its
 * records, and `cached` settles once they are stored, so a coverage commit
 * never precedes the records it describes.
 */
export const fetchChannelServerPage: FetchChannelServerPage = async (
  input,
  signal
) => {
  const { data, cached } = await queryChannelNetwork(
    ChannelTimelineDocument,
    { input },
    signal
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
  | { kind: 'page'; page: ChannelPage; seq: string | null }
  | { kind: 'miss'; seq: string | null }
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
  if (!result.covered) return { kind: 'miss', seq: result.seq };
  const records = await readTimelineRecords(host, result.keys);
  if (!records) return { kind: 'miss', seq: result.seq };
  return {
    kind: 'page',
    page: {
      entries: pageEntries(records),
      olderCursor: result.olderCursor,
      newerCursor: result.newerCursor,
    },
    seq: result.seq,
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
 * Marks the channel opened when its clock is due. Rides on a commit the page
 * makes anyway; otherwise it is the one write an open makes, at most once per
 * channel every six hours.
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
  fireAndForget(
    commitTouch(deps.touches, { channelId, touchedAtMs, generation }, () =>
      deps.host.channelTimelineCommit({ channelId, touchedAtMs }, generation)
    ),
    'channel-local-sync'
  );
}

/**
 * Loads one page: from the device when it holds the stretch, otherwise from
 * the server, whose page is then committed as held. A host that has not
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
  // A reset or eviction after this must not be followed by its coverage.
  const resets = channelResetMark(host, request.channelId);
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
        stored: Promise.resolve({ kind: 'stored', seq: device.seq }),
      };
    }
  }
  span.setAttr(
    'page.source',
    device === 'not-ready' ? 'server-cold' : 'server'
  );
  // Held from before the fetch until its coverage is sent: no other tab's
  // delete lands between them. Null when one is pending: no coverage then.
  const hold = await holdAgainstDeletes();
  const release = () => hold?.release();
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
          signal
        )
      ),
      device === 'not-ready' ? read : undefined
    );
  } catch (error) {
    release();
    throw error;
  }
  if (fetched.from === 'device') {
    release();
    span.setAttr('page.source', 'device-offline');
    touchChannel(deps, request.channelId, generation);
    return {
      page: fetched.read.page,
      source: 'device',
      stored: Promise.resolve({ kind: 'stored', seq: fetched.read.seq }),
    };
  }
  const { page, cached } = fetched;
  span.setAttr('page.entries', page.entries.length);
  const coverage = serverPageCoverage(request, page);
  const commit = async (): Promise<string | null | 'yielded'> => {
    try {
      return await commitPage();
    } finally {
      release();
    }
  };
  const commitPage = async (): Promise<string | null | 'yielded'> => {
    await cached;
    // A cold host is asked again once it can answer.
    const held = device === 'not-ready' ? await read : device;
    if (held.kind === 'unsupported') {
      markChannelCacheUnsupported(host as CacheHost);
      return null;
    }
    if (held.kind === 'failed') return null;
    markChannelCacheAnswered(host as CacheHost);
    // A delete in another tab came first, or the hold ran past its limit,
    // which a reset stops waiting for: the records the page stored may be
    // gone. Nothing tells this view when that delete is done, so it reads
    // again after it. Nothing awaits from here to the send.
    if (!hold?.current()) return 'yielded';
    // Deleted here meanwhile: the reset or eviction rereads the views itself.
    if (!unchangedSince(host, request.channelId, resets)) return null;
    const touchedAtMs = deps.touches.due(
      request.channelId,
      (deps.now ?? Date.now)(),
      generation
    );
    const committed = await commitTouch(
      deps.touches,
      { channelId: request.channelId, touchedAtMs, generation },
      () =>
        host.channelTimelineCommit(
          {
            channelId: request.channelId,
            ...(coverage && { coverage: [coverage] }),
            seq: { kind: 'lower', seq: page.seq },
            ...(touchedAtMs !== undefined && { touchedAtMs }),
          },
          generation
        )
    );
    return committed.kind === 'committed' ? committed.channelSeq : held.seq;
  };
  // A child of the page's span: the page answers before the device stores it.
  const store = (child: Span): Promise<PageStored> =>
    storedOutcome(commit(), child);
  return {
    page: {
      entries: pageEntries(page.entries),
      olderCursor: page.olderCursor,
      newerCursor: page.newerCursor,
    },
    source: 'server',
    readSeq: page.seq,
    stored: span.span('channel.page.store', store),
  };
}

/**
 * How a store step ended, as a value: a loader that moved on leaves the
 * promise unawaited, so it must not reject. Failures other than a session
 * change are reported here.
 */
async function storedOutcome(
  commit: Promise<string | null | 'yielded'>,
  span: Span
): Promise<PageStored> {
  try {
    const seq = await commit;
    if (seq === 'yielded') {
      span.setAttr('page.stored', 'yielded');
      return { kind: 'yielded' };
    }
    span.setAttr('page.stored', seq === null ? 'unheld' : 'held');
    return { kind: 'stored', seq };
  } catch (error) {
    if (cacheSessionChanged(error)) {
      span.setAttr('page.stored', 'session-changed');
      return { kind: 'session-changed' };
    }
    span.setAttr('page.stored', 'failed');
    span.error(error);
    Telemetry.error(error, { surface: 'channel-local-sync' });
    return { kind: 'stored', seq: null };
  }
}
