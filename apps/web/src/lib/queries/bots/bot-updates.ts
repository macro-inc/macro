import { fireAndForget } from '@core/util/fireAndForget';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type {
  BotFieldsFragment,
  BotUpdatesSubscription,
} from '@service-storage/graphql/generated/graphql';
import type { Client, OperationResult } from '@urql/core';
import { agentKeys } from '../agents/keys';
import { channelKeys } from '../channel/keys';
import { queryClient } from '../client';
import { revalidateBotReads } from './graphql-bots';
import { botKeys } from './keys';

/**
 * The REST bot lists (settings' bots and agents, each channel's bots) hold
 * copies the normalized cache can't reach, and a push carries no channel,
 * while a bot joining or leaving a channel is pushed to its members. So
 * every bot push refetches them; pushes are rare. `bots` null means changes
 * may have been missed.
 */
export function invalidateRestBotLists(
  bots: readonly Pick<BotFieldsFragment, 'id' | 'deletedAt'>[] | null
) {
  queryClient.invalidateQueries({ queryKey: agentKeys.list.queryKey });
  queryClient.invalidateQueries({ queryKey: botKeys.list.queryKey });
  queryClient.invalidateQueries({ queryKey: channelKeys.channelBots._def });
  if (bots === null) {
    queryClient.invalidateQueries({ queryKey: botKeys.detail._def });
    return;
  }
  for (const bot of bots)
    queryClient.invalidateQueries({
      queryKey: botKeys.detail(bot.id).queryKey,
    });
}

/** The `botUpdates` subscription's handler for one websocket client. */
export function createBotUpdatesHandler(client: Pick<Client, 'query'>) {
  return {
    onResult(result: OperationResult<BotUpdatesSubscription>) {
      const bots = result.data?.botUpdates;
      if (result.error || !bots?.length) return;
      invalidateRestBotLists(bots);
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
