import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { ThrownResultError } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/host/types';
import {
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
import type { MessageCursor } from '@service-storage/messages';
import {
  type AnyVariables,
  CombinedError,
  type DocumentInput,
  type OperationResult,
  type OperationResultSource,
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

/**
 * The query's first complete result. An abort unsubscribes, which is what
 * cancels the request: the client replaces a signal passed in its fetch
 * options with its own.
 */
function firstResult<Data, Variables extends AnyVariables>(
  source: OperationResultSource<OperationResult<Data, Variables>>,
  signal?: AbortSignal
): Promise<OperationResult<Data, Variables>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const finish = () => {
      settled = true;
      signal?.removeEventListener('abort', abort);
      unsubscribe?.();
    };
    const abort = () => {
      finish();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const subscription = source.subscribe((result) => {
      if (settled || result.stale || result.hasNext) return;
      finish();
      resolve(result);
    });
    unsubscribe = () => subscription.unsubscribe();
    // A result delivered while subscribing settled before there was anything
    // to unsubscribe.
    if (settled) unsubscribe();
  });
}

async function queryUncached<Data, Variables extends AnyVariables>(
  document: DocumentInput<Data, Variables>,
  variables: Variables,
  signal?: AbortSignal
): Promise<Data> {
  const result = await firstResult(
    getUncachedGraphqlSoupClient().query(document, variables, {
      requestPolicy: 'network-only',
    }),
    signal
  );
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

/** Replaces the latest page the cache holds for the channel. */
export async function writeCachedLatestPage(
  host: Pick<CacheHost, 'writeQuery'>,
  channelId: string,
  latest: LatestChannelPage
): Promise<void> {
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
}
