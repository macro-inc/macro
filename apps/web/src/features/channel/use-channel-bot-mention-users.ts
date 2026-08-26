import type { IUser } from '@core/user/types';
import { usePersonasQuery } from '@queries/bots/personas';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import { type Accessor, createMemo } from 'solid-js';

/**
 * The bots mentionable in this channel as synthetic [`IUser`] entries for the
 * `@`-mention typeahead: the caller's personas (their "agents", mentionable
 * everywhere) followed by the channel's own bots. `id` uses the canonical
 * `bot|<uuid>` principal form so mentions are re-tagged as bot mentions at
 * send time (see `expandMentions`).
 *
 * Personas put their handle in `email` so typing `@bug-` matches "Bug Fixer"
 * (the typeahead searches name and email); channel bots keep their name
 * there, matching how their persisted mentions have always rendered.
 */
export function useChannelBotMentionUsers(
  channelId: Accessor<string>
): Accessor<IUser[]> {
  const channelBots = useChannelBotsQuery(channelId);
  const personas = usePersonasQuery();

  return createMemo(() => {
    const seen = new Set<string>();
    const users: IUser[] = [];
    for (const persona of personas.data ?? []) {
      const id = `bot|${persona.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      users.push({ id, name: persona.name, email: persona.handle });
    }
    for (const bot of channelBots.data ?? []) {
      const id = `bot|${bot.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      users.push({ id, name: bot.name, email: bot.name });
    }
    return users;
  });
}
