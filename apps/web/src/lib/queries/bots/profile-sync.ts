import { fireAndForget } from '@core/util/fireAndForget';
import { getBotOwnerProfilesResponseItem } from '@service-storage/generated/zod';
import { agentKeys } from '../agents/keys';
import { channelKeys } from '../channel/keys';
import { queryClient } from '../client';
import { botKeys, botProfileKeys } from './keys';
import { toBotProfile } from './profiles';

/** Gateway message carrying a bot's current profile. */
export const BOT_PROFILE_CHANGED_EVENT = 'bot_profile_changed';

/**
 * Apply a bot's current profile, pushed whenever the bot is created, renamed,
 * given a picture or deleted, whoever changed it. Every message, mention and
 * session reads the profile cache, so they change at once; the lists the
 * mention menu and settings read are refetched, since only the server knows
 * which of them hold the bot.
 */
export function handleBotProfileChanged(payload: unknown): void {
  const parsed = getBotOwnerProfilesResponseItem.safeParse(payload);
  if (!parsed.success) return;
  const profile = parsed.data;

  queryClient.setQueryData(
    botProfileKeys.detail(profile.id).queryKey,
    toBotProfile(profile)
  );
  fireAndForget(
    Promise.all([
      queryClient.invalidateQueries({ queryKey: agentKeys.list.queryKey }),
      queryClient.invalidateQueries({ queryKey: botKeys.list.queryKey }),
      queryClient.invalidateQueries({
        queryKey: botKeys.detail(profile.id).queryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: channelKeys.channelBots._def,
      }),
    ]),
    'bot-profile-sync'
  );
}

/** Recover bot changes missed while the gateway was disconnected. */
export function invalidateBotProfiles(): void {
  fireAndForget(
    Promise.all([
      queryClient.invalidateQueries({ queryKey: botProfileKeys._def }),
      queryClient.invalidateQueries({ queryKey: agentKeys.list.queryKey }),
      queryClient.invalidateQueries({ queryKey: channelKeys.channelBots._def }),
    ]),
    'bot-profile-sync'
  );
}
