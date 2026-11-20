import type { CacheHost } from '@graphql-cache/host/types';
import { readRecordsByKeys, selectRecords } from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import {
  ChannelViewedAtCacheWriteDocument,
  type ChannelViewedAtCacheWriteSubscription,
  ChannelViewedAtFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import type { QueryClient } from '@tanstack/solid-query';
import { stringifyDocument } from '@urql/core';
import { CHANNEL_RECORD_PREFIX } from './directory-cache';
import type { DirectoryChannel } from './directory-core';
import { channelKeys } from './keys';

const VIEWED_AT_SELECTION = selectRecords(ChannelViewedAtFieldsFragmentDoc);
const VIEWED_AT_WRITE = stringifyDocument(ChannelViewedAtCacheWriteDocument);

/** Whether `next` is a later view than `current`. */
function isLater(current: string | null, next: string) {
  return current === null || Date.parse(next) > Date.parse(current);
}

/**
 * Stamps a view the server recorded on the channel's cached record, which the
 * server's soup updates do not carry, so the next open of the channel marks
 * only later messages as new. A channel the cache does not hold is left
 * alone: writing would leave a record without the directory's fields. A
 * stamp never moves a view back.
 */
export async function stampCachedChannelView(
  host: Pick<CacheHost, 'readRecordsByKeys' | 'writeQuery'>,
  channelId: string,
  viewedAt: string,
  generation = cacheSessionGeneration.capture()
): Promise<boolean> {
  const { records } = await readRecordsByKeys(host, VIEWED_AT_SELECTION, [
    `${CHANNEL_RECORD_PREFIX}${channelId}`,
  ]);
  const record = records[0]?.record;
  if (!record) return false;
  const current = typeof record.viewedAt === 'string' ? record.viewedAt : null;
  if (!isLater(current, viewedAt)) return true;
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

/** Stamps a recorded view on the in-memory directory's copy of the channel,
 * for a session without the cache. */
export function stampMemoryChannelView(
  client: QueryClient,
  userId: string,
  channelId: string,
  viewedAt: string
) {
  client.setQueryData<DirectoryChannel[]>(
    channelKeys.directory(userId).queryKey,
    (channels) =>
      channels?.map((channel) =>
        channel.id === channelId && isLater(channel.viewedAt, viewedAt)
          ? { ...channel, viewedAt }
          : channel
      )
  );
}
