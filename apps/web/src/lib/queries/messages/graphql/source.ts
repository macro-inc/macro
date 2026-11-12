import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { ThrownResultError } from '@core/util/result';
import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import type { CacheHost } from '@graphql-cache/host/types';
import { MAX_RECORD_SELECTION_PAGE_SIZE } from '@graphql-cache/protocol';
import {
  type ChannelCachedPageRowsFragment,
  ChannelCachedPageRowsFragmentDoc,
  ChannelChangesDocument,
  type ChannelChangesQuery,
  ChannelTimelineDocument,
  type ChannelTimelineQuery,
  type GraphqlChannelTimelineInput,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getUncachedGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type {
  MessageCursor,
  MessageTimelinePage,
} from '@service-storage/messages';
import {
  type AnyVariables,
  CombinedError,
  type DocumentInput,
  stringifyDocument,
} from '@urql/core';
import {
  type ChannelTimelineRead,
  cursorToGraphql,
  timelinePageFromGraphql,
  timelinePageToGraphql,
} from './convert';

const TIMELINE_QUERY = stringifyDocument(ChannelTimelineDocument);
const TIMELINE_OPERATION = 'ChannelTimeline';
const PAGE_ROWS = selectRecords(ChannelCachedPageRowsFragmentDoc);

/** A latest page with the user record it hangs off, which a cache write names. */
export type LatestChannelPage = ChannelTimelineRead & { userId: string };

export type ChannelChanges =
  ChannelChangesQuery['user']['channelMessages']['changes'];

/** Which page other than the latest to read. */
export type ChannelPageSelection =
  | { around: string }
  | { cursor: MessageCursor; direction: 'older' | 'newer' };

/**
 * The cache host that keeps channel timelines, or `undefined` when channels
 * read from REST: the flag is off or the device cache is unavailable.
 */
export function channelCacheHost(): CacheHost | undefined {
  if (!isFeatureEnabled(enableGraphqlSoup)) return undefined;
  const host = getGraphqlSoupCacheHost();
  return host && !host.disabled ? host : undefined;
}

/** The variables of the one page the cache keeps per channel. */
function latestPageVariables(channelId: string) {
  return { channelId, input: null };
}

/**
 * Refusals keep the codes the REST client reports, which the timeline's
 * retry and missing-target handling read.
 */
function readError(error: unknown): unknown {
  if (!(error instanceof CombinedError) || error.graphQLErrors.length === 0) {
    return error;
  }
  return new ThrownResultError(
    error.graphQLErrors.map((refusal) => ({
      code:
        typeof refusal.extensions?.code === 'string'
          ? refusal.extensions.code
          : 'INTERNAL_SERVER_ERROR',
      message: refusal.message,
    }))
  );
}

async function queryUncached<Data, Variables extends AnyVariables>(
  document: DocumentInput<Data, Variables>,
  variables: Variables,
  signal?: AbortSignal
): Promise<Data> {
  const result = await getUncachedGraphqlSoupClient()
    .query(document, variables, {
      requestPolicy: 'network-only',
      ...(signal ? { fetchOptions: { signal } } : {}),
    })
    .toPromise();
  if (result.error) throw readError(result.error);
  if (!result.data) throw new Error('Channel query returned no data');
  return result.data;
}

/**
 * Reads the latest page from the server. The caller writes it to the cache
 * afterwards: a read that waited for the cache's own write would hold the
 * channel's open behind a cache that is starting or busy.
 */
export async function fetchLatestChannelPage(
  channelId: string,
  signal?: AbortSignal
): Promise<LatestChannelPage> {
  const data = await queryUncached(
    ChannelTimelineDocument,
    latestPageVariables(channelId),
    signal
  );
  return {
    ...timelinePageFromGraphql(data.user.channelMessages.timeline),
    userId: data.user.id,
  };
}

/**
 * Reads a page the cache does not keep: one behind a cursor or around a
 * message. Only the latest page opens a channel, and a kept page nothing
 * reads again would only grow the channel's record.
 */
export async function fetchChannelPage(
  channelId: string,
  selection: ChannelPageSelection,
  limit: number,
  signal?: AbortSignal
): Promise<ChannelTimelineRead> {
  const input: GraphqlChannelTimelineInput =
    'around' in selection
      ? { around: selection.around, limit }
      : {
          cursor: cursorToGraphql(selection.cursor),
          direction: selection.direction === 'newer' ? 'NEWER' : 'OLDER',
          limit,
        };
  const data = await queryUncached(
    ChannelTimelineDocument,
    { channelId, input },
    signal
  );
  return timelinePageFromGraphql(data.user.channelMessages.timeline);
}

/** What changed in the channel after `since`, or a reset. */
export async function fetchChannelChanges(
  channelId: string,
  since: number
): Promise<ChannelChanges> {
  const data = await queryUncached(ChannelChangesDocument, {
    channelId,
    since,
  });
  return data.user.channelMessages.changes;
}

/** The latest page the cache holds for the channel, if any. */
export async function readCachedLatestPage(
  host: Pick<CacheHost, 'readQuery'>,
  channelId: string
): Promise<LatestChannelPage | undefined> {
  const read = await host.readQuery({
    query: TIMELINE_QUERY,
    operationName: TIMELINE_OPERATION,
    variables: latestPageVariables(channelId),
    priority: 'user-visible',
  });
  if (read.kind !== 'hit') return undefined;
  // The generated document defines the normalized cache result's shape.
  const data = read.data as ChannelTimelineQuery;
  return {
    ...timelinePageFromGraphql(data.user.channelMessages.timeline),
    userId: data.user.id,
  };
}

function recordKey(typename: string, id: string): string {
  return `${typename}:${id}`;
}

/**
 * The records a latest page is stored in: the channel's own, which holds the
 * page, and one per row it shows, thread previews included.
 */
export function latestPageRecordKeys(
  channelId: string,
  page: MessageTimelinePage
): string[] {
  const keys = [recordKey('GraphqlChannelMessages', channelId)];
  for (const entry of page.entries) {
    if (entry.type === 'activity') {
      keys.push(recordKey('GraphqlChannelTimelineActivity', entry.activity.id));
      continue;
    }
    keys.push(recordKey('GraphqlChannelMessage', entry.message.id));
    for (const reply of entry.message.thread.preview) {
      keys.push(recordKey('GraphqlChannelMessage', reply.id));
    }
  }
  return keys;
}

function storedPageRecordKeys(page: ChannelCachedPageRowsFragment): string[] {
  const keys = [recordKey('GraphqlChannelMessages', page.id)];
  for (const entry of page.timeline.entries) {
    keys.push(recordKey(entry.__typename, entry.id));
    if (entry.__typename !== 'GraphqlChannelMessage') continue;
    for (const reply of entry.thread?.preview ?? []) {
      keys.push(recordKey('GraphqlChannelMessage', reply.id));
    }
  }
  return keys;
}

/**
 * The records each channel's cached latest page is stored in, for the
 * channels that have one. They are read by the record that holds the page,
 * not through the viewer, so a page whose viewer link the engine dropped is
 * still found.
 */
export async function readCachedPageRecords(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  channelIds: readonly string[]
): Promise<Map<string, string[]>> {
  const pages = new Map<string, string[]>();
  for (
    let offset = 0;
    offset < channelIds.length;
    offset += MAX_RECORD_SELECTION_PAGE_SIZE
  ) {
    const keys = channelIds
      .slice(offset, offset + MAX_RECORD_SELECTION_PAGE_SIZE)
      .map((channelId) => recordKey('GraphqlChannelMessages', channelId));
    const { records } = await readRecordsByKeys(host, PAGE_ROWS, keys);
    for (const { record } of records) {
      pages.set(record.id, storedPageRecordKeys(record));
    }
  }
  return pages;
}

type PageWriteHost = Pick<
  CacheHost,
  'writeQuery' | 'readRecordsByKeys' | 'deleteRecords'
>;

/** Each channel's page write in progress; the next one waits for it. */
const pageWrites = new Map<string, Promise<void>>();

async function settled(write: Promise<void> | undefined): Promise<void> {
  try {
    await write;
  } catch {
    // Its own caller handles its failure; the next write still runs.
  }
}

/**
 * Replaces the latest page the cache holds for the channel, then deletes the
 * rows the old page held that the new one does not. Nothing else links to a
 * channel's rows, so a write that dropped them would leave them stored for
 * good; this keeps a channel's records at one page. A channel's writes run one
 * at a time: one that read the rows held before another's write would delete
 * rows the other's page still shows.
 */
export async function writeCachedLatestPage(
  host: PageWriteHost,
  channelId: string,
  latest: LatestChannelPage
): Promise<void> {
  const previous = pageWrites.get(channelId);
  const write = (async () => {
    await settled(previous);
    await replaceCachedLatestPage(host, channelId, latest);
  })();
  pageWrites.set(channelId, write);
  try {
    await write;
  } finally {
    if (pageWrites.get(channelId) === write) pageWrites.delete(channelId);
  }
}

async function replaceCachedLatestPage(
  host: PageWriteHost,
  channelId: string,
  latest: LatestChannelPage
): Promise<void> {
  const held = await readCachedPageRecords(host, [channelId]);
  await host.writeQuery({
    query: TIMELINE_QUERY,
    operationName: TIMELINE_OPERATION,
    variables: latestPageVariables(channelId),
    data: {
      user: {
        id: latest.userId,
        channelMessages: {
          id: channelId,
          timeline: timelinePageToGraphql(latest),
        },
      },
    } satisfies ChannelTimelineQuery,
  });
  const kept = new Set(latestPageRecordKeys(channelId, latest.page));
  const dropped = (held.get(channelId) ?? []).filter((key) => !kept.has(key));
  if (dropped.length > 0) await host.deleteRecords(dropped);
}
