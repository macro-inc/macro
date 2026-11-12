import { fireAndForget } from '@core/util/fireAndForget';
import {
  type CacheHost,
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
  type ChannelCoverageWire,
  type ChannelTimelineCacheArgs,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  ChannelMessageFieldsFragmentDoc,
  ChannelTimelineActivityFieldsFragmentDoc,
  ChannelTimelineDocument,
  type ChannelTimelineInput,
  type ChannelTimelineQuery,
} from '@service-storage/graphql/generated/graphql';
import type {
  MessageTimelineEntry,
  MessageTimelinePage,
} from '@service-storage/messages';
import { fetchPublished } from '../../calendar/graphql/network';
import { withinCacheHeadStart } from '../../calendar/graphql/readiness';
import {
  CHANNEL_CACHE_HEAD_START_MS,
  channelCacheAnswered,
  markChannelCacheAnswered,
  markChannelCacheUnsupported,
} from './flag';
import { type ChannelTimelineRecord, mapChannelTimelineEntry } from './map';
import {
  CHANNEL_ACTIVITY_TYPENAME,
  channelMessageKey,
  cursorFromSortKey,
} from './sort-key';

export type ChannelPageHost = Pick<
  CacheHost,
  'channelTimeline' | 'channelTimelineCommit' | 'readRecordsByKeys'
>;

export type ChannelServerPage = ChannelTimelineQuery['user']['channelTimeline'];

export interface FetchedChannelPage {
  page: ChannelServerPage;
  /** Settles once the page's records are in the cache. */
  cached: Promise<void>;
}

/** Fetches one page; resolves when it arrives, before the cache holds it. */
export type FetchChannelServerPage = (
  input: ChannelTimelineInput,
  signal?: AbortSignal
) => Promise<FetchedChannelPage>;

/** One channel page; at most one of the three anchors. */
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

export type ChannelPageSource = 'device' | 'server';

export type LoadedChannelPage =
  | {
      page: MessageTimelinePage;
      source: 'device';
      /** Change sequence the device holds for the channel. */
      storedSeq: string | null;
    }
  | {
      page: MessageTimelinePage;
      source: 'server';
      /** Change sequence the server read the page at. */
      serverSeq: string;
      /**
       * Settles once the device holds the page, with the change sequence it
       * then holds for the channel. The page is usable before that.
       */
      stored: Promise<string | null>;
    };

/** Why a page could not come from the device cache path at all. */
export type ChannelPageUnavailable = 'unsupported' | 'not-ready';

const messageSelection = selectRecords(ChannelMessageFieldsFragmentDoc);
const activitySelection = selectRecords(
  ChannelTimelineActivityFieldsFragmentDoc
);

const fetchChannelServerPage: FetchChannelServerPage = async (
  input,
  signal
) => {
  const published = await fetchPublished(
    ChannelTimelineDocument,
    { input },
    { signal }
  );
  return {
    page: published.data.user.channelTimeline,
    cached: published.cached,
  };
};

// Server pages still being written to the device, by request. A read of the
// same page in that window would miss on the device and fetch it again.
const pendingServerPages = new Map<string, LoadedChannelPage>();
// Foreground loads still running, by request: two readers of one page share
// one device read and one request.
const loadsInFlight = new Map<
  string,
  Promise<LoadedChannelPage | ChannelPageUnavailable>
>();
// Channels whose latest page the device is known to hold. Asking the device
// costs a turn of a busy main thread, so the latest page of any other channel
// is requested at the same time as it is looked up.
const heldChannels = new Set<string>();

/**
 * Reads the records behind page keys in key order. Undefined when a key has no
 * readable record, such as one cached by a build that selected fewer fields.
 */
async function readTimelineRecords(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  keys: readonly string[]
): Promise<ChannelTimelineRecord[] | undefined> {
  const activityKeys = keys.filter((key) =>
    key.startsWith(`${CHANNEL_ACTIVITY_TYPENAME}:`)
  );
  const activityKeySet = new Set(activityKeys);
  const messageKeys = keys.filter((key) => !activityKeySet.has(key));
  const [messages, activities] = await Promise.all([
    messageKeys.length > 0
      ? readRecordsByKeys(host, messageSelection, messageKeys)
      : undefined,
    activityKeys.length > 0
      ? readRecordsByKeys(host, activitySelection, activityKeys)
      : undefined,
  ]);
  const byKey = new Map<string, ChannelTimelineRecord>();
  for (const { recordKey, record } of messages?.records ?? []) {
    byKey.set(recordKey, record);
  }
  for (const { recordKey, record } of activities?.records ?? []) {
    byKey.set(recordKey, record);
  }
  const records: ChannelTimelineRecord[] = [];
  for (const key of keys) {
    const record = byKey.get(key);
    if (!record) return undefined;
    records.push(record);
  }
  return records;
}

function mapEntries(
  records: readonly ChannelTimelineRecord[]
): MessageTimelineEntry[] {
  return records.flatMap((record) => mapChannelTimelineEntry(record) ?? []);
}

function timelinePage(
  records: readonly ChannelTimelineRecord[],
  olderCursor: string | null,
  newerCursor: string | null
): MessageTimelinePage {
  return {
    entries: mapEntries(records),
    next_cursor: olderCursor === null ? null : cursorFromSortKey(olderCursor),
    previous_cursor:
      newerCursor === null ? null : cursorFromSortKey(newerCursor),
  };
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

type DeviceRead =
  | { kind: 'page'; page: MessageTimelinePage; storedSeq: string | null }
  | { kind: 'miss'; storedSeq: string | null }
  | { kind: 'unsupported' };

/** Answers a page from the device, or says why the server must. */
export async function readDeviceChannelPage(
  host: Pick<CacheHost, 'channelTimeline' | 'readRecordsByKeys'>,
  request: ChannelPageRequest
): Promise<DeviceRead> {
  const result = await host.channelTimeline(cacheArgs(request));
  if (result.kind === 'unsupported') return { kind: 'unsupported' };
  if (!result.covered) return { kind: 'miss', storedSeq: result.seq };
  const records = await readTimelineRecords(host, result.keys);
  if (!records) return { kind: 'miss', storedSeq: result.seq };
  return {
    kind: 'page',
    page: timelinePage(records, result.olderCursor, result.newerCursor),
    storedSeq: result.seq,
  };
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

/**
 * Runs follow-up work whose failure another holder of the same promise
 * reports, or which changes nothing shown.
 */
function quietly(work: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await work();
    } catch {
      // Reported where the page is used.
    }
  };
  fireAndForget(run(), 'channel-local-sync');
}

interface LoadChannelPageOptions {
  signal?: AbortSignal;
  fetchPage?: FetchChannelServerPage;
  now?: () => number;
  /** Idle work: wait on the device and never race the server against it. */
  background?: boolean;
}

type RacedRead =
  | { from: 'device'; device: DeviceRead }
  | { from: 'server'; fetched: FetchedChannelPage };

/**
 * How long a failed request waits for a device that is still starting before
 * the failure stands: offline, the device is the only place a page can come
 * from.
 */
const FAILED_REQUEST_DEVICE_WAIT_MS = 10_000;

/** The server's page; when the request fails, what the device holds instead. */
async function serverOrDevice(
  server: Promise<FetchedChannelPage>,
  read: Promise<DeviceRead>
): Promise<RacedRead> {
  try {
    return { from: 'server', fetched: await server };
  } catch (error) {
    const device = await withinCacheHeadStart(
      read,
      FAILED_REQUEST_DEVICE_WAIT_MS
    );
    if (device === 'not-ready') throw error;
    return { from: 'device', device };
  }
}

/**
 * Loads one channel page: from the device when it holds the stretch, otherwise
 * from the server, which is then recorded as held. A host that has not
 * answered yet is still starting, and the latest page of a channel not yet
 * known to be held would wait on the device only to miss, so for both the
 * server is asked at the same time and the first page wins: opening is never
 * slower than without the device.
 * `background` work instead gives the host a head start and resolves to
 * `not-ready` past it. Resolves to the reason when the device path cannot
 * serve channels, so the caller reads over REST.
 */
export async function loadChannelPage(
  host: ChannelPageHost & object,
  request: ChannelPageRequest,
  options: LoadChannelPageOptions = {}
): Promise<LoadedChannelPage | ChannelPageUnavailable> {
  return Telemetry.span('channel.timeline_page', async (span) => {
    span.setAttr('channel.id', request.channelId);
    span.setAttr('page.limit', request.limit);
    span.setAttr(
      'page.anchor',
      request.aroundMessageId !== undefined
        ? 'around'
        : request.before !== undefined
          ? 'before'
          : request.after !== undefined
            ? 'after'
            : 'latest'
    );
    const pendingKey = JSON.stringify(cacheArgs(request));
    const pending = pendingServerPages.get(pendingKey);
    if (pending) {
      span.setAttr('page.source', 'server-pending');
      return pending;
    }
    if (options.background) return loadPage(host, request, options, span);
    const running = loadsInFlight.get(pendingKey);
    if (running) {
      try {
        const shared = await running;
        span.setAttr('page.source', 'shared');
        return shared;
      } catch (error) {
        // The other reader's failure, such as its cancellation, is not this
        // one's: load again unless this reader was cancelled too.
        if (options.signal?.aborted) throw error;
      }
    }
    const load = loadPage(host, request, options, span);
    loadsInFlight.set(pendingKey, load);
    try {
      return await load;
    } finally {
      if (loadsInFlight.get(pendingKey) === load) {
        loadsInFlight.delete(pendingKey);
      }
    }
  });
}

async function loadPage(
  host: ChannelPageHost & object,
  request: ChannelPageRequest,
  options: LoadChannelPageOptions,
  span: Span
): Promise<LoadedChannelPage | ChannelPageUnavailable> {
  const cacheHost = host as CacheHost;
  const pendingKey = JSON.stringify(cacheArgs(request));
  const latest =
    request.before === undefined &&
    request.after === undefined &&
    request.aroundMessageId === undefined;
  const answered = channelCacheAnswered(cacheHost);
  const fetchPage = options.fetchPage ?? fetchChannelServerPage;
  const fetchServer = () =>
    fetchPage(
      {
        channelId: request.channelId,
        limit: request.limit,
        before: request.before,
        after: request.after,
        around: request.aroundMessageId,
      },
      options.signal
    );
  const read = readDeviceChannelPage(host, request);
  let device: DeviceRead | undefined;
  let fetched: FetchedChannelPage | undefined;
  if (
    answered &&
    (options.background || !latest || heldChannels.has(request.channelId))
  ) {
    device = await read;
  } else if (options.background) {
    const early = await withinCacheHeadStart(read, CHANNEL_CACHE_HEAD_START_MS);
    if (early === 'not-ready') {
      span.setAttr('page.source', 'not-ready');
      return 'not-ready';
    }
    device = early;
  } else {
    const server = fetchServer();
    const first = await Promise.race<RacedRead>([
      (async () => ({ from: 'device', device: await read }))(),
      serverOrDevice(server, read),
    ]);
    span.setAttr('page.raced', first.from);
    if (first.from === 'server') {
      fetched = first.fetched;
    } else {
      device = first.device;
      if (device.kind === 'miss') {
        fetched = await server;
      } else {
        // The device answered first; the request's records still land in
        // the cache, and a failure of it changes nothing shown.
        quietly(async () => (await server).cached);
      }
    }
  }
  if (device?.kind === 'unsupported') {
    markChannelCacheUnsupported(cacheHost);
    span.setAttr('page.source', 'unsupported');
    return 'unsupported';
  }
  if (device) markChannelCacheAnswered(cacheHost);
  if (latest && device?.kind === 'miss') {
    heldChannels.delete(request.channelId);
  }
  if (device?.kind === 'page') {
    if (latest) heldChannels.add(request.channelId);
    span.setAttr('page.source', 'device');
    span.setAttr('page.entries', device.page.entries.length);
    return {
      page: device.page,
      source: 'device',
      storedSeq: device.storedSeq,
    };
  }
  const { page: server, cached } = fetched ?? (await fetchServer());
  const coverage = serverPageCoverage(request, server);
  const store = async (): Promise<string | null> => {
    await cached;
    // The page won a race against a host that had not answered: record it
    // once the host can, unless it turns out unable to hold channels.
    const held = device ?? (await read);
    if (held.kind === 'unsupported') {
      markChannelCacheUnsupported(cacheHost);
      return null;
    }
    markChannelCacheAnswered(cacheHost);
    const committed = await host.channelTimelineCommit({
      channelId: request.channelId,
      ...(coverage && { coverage: [coverage] }),
      seq: { kind: 'lower', seq: server.seq },
      touchedAtMs: (options.now ?? Date.now)(),
    });
    if (committed.kind !== 'committed') return held.storedSeq;
    if (latest && coverage) heldChannels.add(request.channelId);
    return committed.channelSeq;
  };
  const stored = store();
  span.setAttr('page.source', 'server');
  span.setAttr('page.entries', server.entries.length);
  const loaded: LoadedChannelPage = {
    page: timelinePage(server.entries, server.olderCursor, server.newerCursor),
    source: 'server',
    serverSeq: server.seq,
    stored,
  };
  pendingServerPages.set(pendingKey, loaded);
  const forget = () => {
    if (pendingServerPages.get(pendingKey) === loaded) {
      pendingServerPages.delete(pendingKey);
    }
  };
  quietly(async () => {
    try {
      await stored;
    } finally {
      forget();
    }
  });
  return loaded;
}

/** Forgets pages still being written; for account changes and tests. */
export function resetPendingChannelPages(): void {
  pendingServerPages.clear();
  loadsInFlight.clear();
  heldChannels.clear();
}
