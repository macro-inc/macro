import type { IUser } from '@core/user/types';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import { type Accessor, createMemo } from 'solid-js';

/**
 * The channel's bots as synthetic [`IUser`] entries for the `@`-mention
 * typeahead. Like `macroAiMentionUser()`, `email` is set to the bot's name so
 * persisted mentions render as "@BotName", and `id` uses the canonical
 * `bot|<uuid>` principal form so mentions are re-tagged as bot mentions at
 * send time (see `expandMentions`).
 */
export function useChannelBotMentionUsers(
  channelId: Accessor<string>
): Accessor<IUser[]> {
  const query = useChannelBotsQuery(channelId);

  return createMemo(() => {
    return (query.data ?? []).map((bot) => ({
      id: `bot|${bot.id}`,
      name: bot.name,
      email: bot.name,
    }));
  });
}
