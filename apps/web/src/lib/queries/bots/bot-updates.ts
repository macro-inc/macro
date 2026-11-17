import { fireAndForget } from '@core/util/fireAndForget';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { BotUpdatesSubscription } from '@service-storage/graphql/generated/graphql';
import type { Client, OperationResult } from '@urql/core';
import { agentKeys } from '../agents/keys';
import { channelKeys } from '../channel/keys';
import { queryClient } from '../client';
import { revalidateBotReads } from './graphql-bots';
import { botKeys } from './keys';

/**
 * The REST lists that still name bots (settings, the mention menu, channel
 * bots) hold copies the normalized cache can't reach, so every change to a
 * bot refetches them. `botIds` null means changes may have been missed.
 */
export function invalidateRestBotLists(botIds: readonly string[] | null) {
  queryClient.invalidateQueries({ queryKey: agentKeys.list.queryKey });
  queryClient.invalidateQueries({ queryKey: botKeys.list.queryKey });
  queryClient.invalidateQueries({ queryKey: channelKeys.channelBots._def });
  if (botIds === null) {
    queryClient.invalidateQueries({ queryKey: botKeys.detail._def });
    return;
  }
  for (const id of botIds)
    queryClient.invalidateQueries({ queryKey: botKeys.detail(id).queryKey });
}

/** The `botUpdates` subscription's handler for one websocket client. */
export function createBotUpdatesHandler(client: Pick<Client, 'query'>) {
  return {
    onResult(result: OperationResult<BotUpdatesSubscription>) {
      const bots = result.data?.botUpdates;
      if (result.error || !bots?.length) return;
      invalidateRestBotLists(bots.map((bot) => bot.id));
      // The normalized cache replaced each `GraphqlBot` record, so mounted
      // reads show the push on their own; a client without the cache, or
      // whose cache could not apply it, reads those bots again. Lists also
      // read again for a bot they lack or a deletion.
      const metadata = normalizedCacheResultMetadata(result);
      const shown =
        metadata?.source === 'live-network' &&
        metadata.cacheEffectsApplied === true;
      fireAndForget(revalidateBotReads(client, { bots, shown }), 'bot-updates');
    },
    /** Pushes may have been missed while the socket was down. */
    reconnect() {
      fireAndForget(revalidateBotReads(client, null), 'bot-updates');
      invalidateRestBotLists(null);
    },
  };
}
