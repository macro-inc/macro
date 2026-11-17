// Delete this file once every client has the Soup GraphQL websocket
// (`enable-graphql-soup` at 100% or removed); the dated cleanup PR does.
// Clients with the websocket never read or write anything here.
import { fireAndForget } from '@core/util/fireAndForget';
import { getBotOwnerProfilesResponseItem } from '@service-storage/generated/zod';
import type { BotFieldsFragment } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  graphqlSoupRealtimeActive,
} from '@service-storage/graphql-soup';
import { ReactiveMap } from '@solid-primitives/map';
import { invalidateRestBotLists } from './bot-updates';
import { revalidateBotReads } from './graphql-bots';

/** Connection-gateway message carrying a bot's current profile. */
export const BOT_PROFILE_CHANGED_EVENT = 'bot_profile_changed';

/** A gateway profile; the message carries no handle or system flag. */
export type GatewayBotProfile = Omit<BotFieldsFragment, 'handle' | 'isSystem'>;

/**
 * Profiles the gateway pushed since it last connected. Without the websocket
 * there is no normalized cache for a push to update, and identity reads go to
 * a replica that can lag the write, so readers take these over what a read
 * returns.
 */
const PUSHED = new ReactiveMap<string, GatewayBotProfile>();

/** The newest gateway profile for `botId`; always empty with the websocket. */
export function gatewayBotProfile(
  botId: string
): GatewayBotProfile | undefined {
  if (graphqlSoupRealtimeActive()) return undefined;
  return PUSHED.get(botId);
}

/**
 * A client without the Soup GraphQL websocket hears bot changes only from the
 * connection gateway. Clients with the websocket ignore this message: the
 * same change arrives as `botUpdates`.
 */
export function handleBotProfileChanged(payload: unknown): void {
  if (graphqlSoupRealtimeActive()) return;
  const parsed = getBotOwnerProfilesResponseItem.safeParse(payload);
  if (!parsed.success) return;
  const profile = parsed.data;
  const pushed = {
    id: profile.id,
    name: profile.name,
    avatarUrl: profile.avatar_url ?? null,
    deletedAt: profile.deleted_at ?? null,
  };
  PUSHED.set(profile.id, pushed);
  invalidateRestBotLists([pushed]);
  // Mounted reads show the profile from here; lists lacking the bot, or
  // holding a deleted one, read again.
  fireAndForget(
    revalidateBotReads(getGraphqlSoupClient(), { bots: [pushed], shown: true }),
    'bot-profile-bridge'
  );
}

/**
 * The gateway (re)connected: pushes may have been missed, so a kept profile
 * could hide a newer one. Drop them and read the mounted bots again.
 */
export function recoverGatewayBotProfiles(): void {
  if (graphqlSoupRealtimeActive()) return;
  PUSHED.clear();
  fireAndForget(
    revalidateBotReads(getGraphqlSoupClient(), null),
    'bot-profile-bridge'
  );
  invalidateRestBotLists(null);
}
