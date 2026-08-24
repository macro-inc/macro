import type { IUser } from '@core/user/types';
import { useMentionableBotsQuery } from '@queries/bots/personas';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import { type Accessor, createMemo } from 'solid-js';

/**
 * The bots mentionable in a channel, as synthetic [`IUser`] entries for the
 * `@`-mention typeahead: the channel's own webhook bots, plus every persona
 * and first-party agent the user can reach anywhere.
 *
 * `id` uses the canonical `bot|<uuid>` principal form so mentions are
 * re-tagged as bot mentions at send time (see `expandMentions`). `email`
 * carries the handle rather than the name, because `useUsersMention` searches
 * `name | email` — without it, typing `@bug-` would not match a persona named
 * "Bug Fixer".
 */
export function useBotMentionUsers(
  channelId: Accessor<string>
): Accessor<IUser[]> {
  const channelBots = useChannelBotsQuery(channelId);
  const mentionableBots = useMentionableBotsQuery();

  return createMemo(() => {
    const channelEntries = (channelBots.data ?? []).map((bot) => ({
      id: `bot|${bot.id}`,
      name: bot.name,
      email: bot.handle,
    }));
    const mentionableEntries = (mentionableBots.data ?? []).map((bot) => ({
      id: `bot|${bot.id}`,
      name: bot.name,
      email: bot.handle,
    }));

    const seen = new Set<string>();
    return [...mentionableEntries, ...channelEntries].filter((user) => {
      if (seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    });
  });
}
