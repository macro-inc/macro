import { firstOrAborted } from '@core/util/abort-signal';
import type { CacheHost } from '@graphql-cache/host/types';
import { readRecordsByKeys, selectRecords } from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import {
  ChannelViewedAtCacheWriteDocument,
  type ChannelViewedAtCacheWriteSubscription,
  ChannelViewedAtFieldsFragmentDoc,
  ViewerChannelViewedAtDocument,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { stringifyDocument } from '@urql/core';
import { okAsync, ResultAsync } from 'neverthrow';
import { filter, pipe } from 'wonka';
import { assertQueryAccount, currentQueryAccount } from '../auth/account-scope';
import { isChannelId } from './channel-id';
import { CHANNEL_RECORD_PREFIX } from './directory-cache';

const VIEWED_AT_SELECTION = selectRecords(ChannelViewedAtFieldsFragmentDoc);
const VIEWED_AT_WRITE = stringifyDocument(ChannelViewedAtCacheWriteDocument);

type StampHost = Pick<CacheHost, 'readRecordsByKeys' | 'writeQuery'>;

/** Whether `next` is a later view than `current`. */
export function isLaterView(current: string | null, next: string) {
  return current === null || Date.parse(next) > Date.parse(current);
}

async function writeLaterView(
  host: StampHost,
  channelId: string,
  viewedAt: string,
  generation: ReturnType<typeof cacheSessionGeneration.capture>
): Promise<boolean> {
  const { records } = await readRecordsByKeys(host, VIEWED_AT_SELECTION, [
    `${CHANNEL_RECORD_PREFIX}${channelId}`,
  ]);
  const record = records[0]?.record;
  if (!record) return false;
  const current = typeof record.viewedAt === 'string' ? record.viewedAt : null;
  if (!isLaterView(current, viewedAt)) return true;
  await host.writeQuery({
    generation,
    query: VIEWED_AT_WRITE,
    operationName: 'ChannelViewedAtCacheWrite',
    variables: {},
    data: {
      soupUpdates: [
        {
          __typename: 'SoupUpdated',
          item: { __typename: 'GraphqlSoupChannel', id: channelId, viewedAt },
        },
      ],
    } satisfies ChannelViewedAtCacheWriteSubscription,
  });
  return true;
}

// The last stamp asked of each channel, per cache host.
const stampsInFlight = new WeakMap<StampHost, Map<string, Promise<boolean>>>();

/**
 * Stamps a view the server recorded on the channel's cached record, which the
 * server's soup updates do not carry, so the next open of the channel marks
 * only later messages as new. A channel the cache does not hold is left
 * alone: writing would leave a record without the directory's fields. A
 * stamp never moves a view back, and stamps of one channel run one after
 * another, so an older one cannot read the record before a newer one's write
 * and then overwrite it.
 */
export async function stampCachedChannelView(
  host: StampHost,
  channelId: string,
  viewedAt: string,
  generation = cacheSessionGeneration.capture()
): Promise<boolean> {
  let inFlight = stampsInFlight.get(host);
  if (!inFlight) {
    inFlight = new Map();
    stampsInFlight.set(host, inFlight);
  }
  const queue = inFlight;
  const before = queue.get(channelId);
  const stamp = (async () => {
    try {
      await before;
    } catch {
      // The earlier stamp's failure is its own caller's to handle.
    }
    return writeLaterView(host, channelId, viewedAt, generation);
  })();
  queue.set(channelId, stamp);
  try {
    return await stamp;
  } finally {
    if (queue.get(channelId) === stamp) queue.delete(channelId);
  }
}

/**
 * When the viewer last viewed a channel, asked of the server, which reads the
 * viewer's own activity row: null when they never viewed it. For a channel
 * the directory does not hold (one they left or never joined), whose record
 * carries no view of theirs. Asking records nothing and skips every cache, so
 * the answer is the server's as of the request. Aborting `signal` ends the
 * request and fails the read with its reason.
 */
export function readChannelViewedAt(
  channelId: string,
  signal?: AbortSignal
): ResultAsync<string | null, unknown> {
  // The server refuses an id it cannot parse, and no view names one.
  if (!isChannelId(channelId)) return okAsync(null);
  return ResultAsync.fromPromise(
    askChannelViewedAt(channelId, signal),
    (error) => error
  );
}

/** An abort leaves the query's result source, which is what ends urql's
 * request: urql replaces a `fetchOptions.signal` with its own. */
async function askChannelViewedAt(
  channelId: string,
  signal: AbortSignal | undefined
): Promise<string | null> {
  signal?.throwIfAborted();
  const account = currentQueryAccount();
  assertQueryAccount(account);
  const settled = await firstOrAborted(
    pipe(
      getGraphqlSoupClient().query(
        ViewerChannelViewedAtDocument,
        { channelId },
        { requestPolicy: 'network-only' }
      ),
      // The answer, as urql's own toPromise takes it.
      filter((result) => !result.stale && !result.hasNext)
    ),
    signal
  );
  if (settled.kind === 'aborted') {
    signal?.throwIfAborted();
    throw new Error('channel view lookup was cancelled');
  }
  if (settled.kind === 'ended')
    throw new Error('channel view lookup ended without an answer');
  const result = settled.value;
  assertQueryAccount(account);
  if (result.error) throw result.error;
  if (!result.data) throw new Error('channel view lookup returned no data');
  return result.data.user.channelViewedAt;
}
