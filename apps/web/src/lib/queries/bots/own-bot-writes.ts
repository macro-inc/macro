import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import {
  BotCacheWriteDocument,
  type BotCacheWriteSubscription,
  BotFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { stringifyDocument } from '@urql/core';
import { revalidateBotIdentities } from './graphql-bots';

const BOT_SELECTION = selectRecords(BotFieldsFragmentDoc);
const BOT_CACHE_WRITE = stringifyDocument(BotCacheWriteDocument);

/** What a confirmed write on this device changed about a bot. */
export type OwnBotWrite = {
  id: string;
  name?: string;
  handle?: string;
  avatarUrl?: string | null;
  deleted?: boolean;
};

/**
 * Show a bot this device just renamed, re-pictured or deleted everywhere at
 * once, without waiting for its `botUpdates` push. With the normalized cache
 * the confirmed write goes into the bot's `GraphqlBot` record; a bot no view
 * has read is left alone. Without the cache, the views showing it read it
 * again.
 */
export async function applyOwnBotWrite(write: OwnBotWrite): Promise<void> {
  const deletedAt = write.deleted ? new Date().toISOString() : null;
  const host = getGraphqlCacheHost();
  if (!host) {
    await revalidateBotIdentities(getGraphqlSoupClient(), new Set([write.id]));
    return;
  }
  const read = await readRecordsByKeys(host, BOT_SELECTION, [
    `GraphqlBot:${write.id}`,
  ]);
  const record = read.records[0]?.record;
  if (!record) return;
  const data = {
    botUpdates: [
      {
        __typename: 'GraphqlBot' as const,
        ...record,
        name: write.name ?? record.name,
        handle: write.handle ?? record.handle,
        avatarUrl:
          write.avatarUrl === undefined ? record.avatarUrl : write.avatarUrl,
        deletedAt: deletedAt ?? record.deletedAt,
      },
    ],
  } satisfies BotCacheWriteSubscription;
  await host.writeQuery({
    query: BOT_CACHE_WRITE,
    operationName: 'BotCacheWrite',
    variables: {},
    data,
  });
}
