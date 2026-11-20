import type { CacheHost } from '@graphql-cache/host/types';
import { readRecordsByKeys, selectRecords } from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import {
  ChannelViewedAtCacheWriteDocument,
  type ChannelViewedAtCacheWriteSubscription,
  ChannelViewedAtFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import { stringifyDocument } from '@urql/core';
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
