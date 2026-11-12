import {
  type CacheHost,
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
  type ChannelCoverageWire,
  type ChannelTimelineCacheArgs,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
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
import { fetchCached } from '../../calendar/graphql/network';
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

/** Fetches one page and resolves once it is written to the cache. */
export type FetchChannelServerPage = (
  input: ChannelTimelineInput,
  signal?: AbortSignal
) => Promise<ChannelServerPage>;

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

export interface LoadedChannelPage {
  page: MessageTimelinePage;
  source: ChannelPageSource;
  /** Change sequence the device holds for the channel after this read. */
  storedSeq: string | null;
  /** Change sequence the server read the page at; absent for a device page. */
  serverSeq?: string;
}

/** Why a page could not come from the device cache path at all. */
export type ChannelPageUnavailable = 'unsupported' | 'not-ready';

const messageSelection = selectRecords(ChannelMessageFieldsFragmentDoc);
const activitySelection = selectRecords(
  ChannelTimelineActivityFieldsFragmentDoc
);

const fetchChannelServerPage: FetchChannelServerPage = async (input, signal) =>
  (await fetchCached(ChannelTimelineDocument, { input }, { signal })).user
    .channelTimeline;

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
 * Loads one channel page: from the device when it holds the stretch, otherwise
 * from the server, which is then recorded as held. Resolves to the reason when
 * the device path cannot serve channels, so the caller reads over REST.
 */
export async function loadChannelPage(
  host: ChannelPageHost & object,
  request: ChannelPageRequest,
  options: {
    signal?: AbortSignal;
    fetchPage?: FetchChannelServerPage;
    now?: () => number;
  } = {}
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
    const read = readDeviceChannelPage(host, request);
    const device = channelCacheAnswered(host as CacheHost)
      ? await read
      : await withinCacheHeadStart(read, CHANNEL_CACHE_HEAD_START_MS);
    if (device === 'not-ready') {
      span.setAttr('page.source', 'not-ready');
      return 'not-ready';
    }
    if (device.kind === 'unsupported') {
      markChannelCacheUnsupported(host as CacheHost);
      span.setAttr('page.source', 'unsupported');
      return 'unsupported';
    }
    markChannelCacheAnswered(host as CacheHost);
    if (device.kind === 'page') {
      span.setAttr('page.source', 'device');
      span.setAttr('page.entries', device.page.entries.length);
      return {
        page: device.page,
        source: 'device',
        storedSeq: device.storedSeq,
      };
    }
    const fetchPage = options.fetchPage ?? fetchChannelServerPage;
    const server = await fetchPage(
      {
        channelId: request.channelId,
        limit: request.limit,
        before: request.before,
        after: request.after,
        around: request.aroundMessageId,
      },
      options.signal
    );
    const coverage = serverPageCoverage(request, server);
    const committed = await host.channelTimelineCommit({
      channelId: request.channelId,
      ...(coverage && { coverage: [coverage] }),
      seq: { kind: 'lower', seq: server.seq },
      touchedAtMs: (options.now ?? Date.now)(),
    });
    span.setAttr('page.source', 'server');
    span.setAttr('page.entries', server.entries.length);
    return {
      page: timelinePage(
        server.entries,
        server.olderCursor,
        server.newerCursor
      ),
      source: 'server',
      storedSeq:
        committed.kind === 'committed'
          ? committed.channelSeq
          : device.storedSeq,
      serverSeq: server.seq,
    };
  });
}
