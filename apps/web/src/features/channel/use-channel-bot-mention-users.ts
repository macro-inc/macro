import type { IUser } from '@core/user/types';
import { useAgentsQuery } from '@queries/agents/agents';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import type { Agent } from '@service-storage/generated/schemas/agent';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { type Accessor, createMemo } from 'solid-js';

function mentionUser(bot: Bot): IUser {
  return {
    id: `bot|${bot.id}`,
    name: bot.name,
    email: bot.name,
    photoUrl: bot.avatar_url ?? undefined,
  };
}

/** Build mention entries from installed channel bots and virtual global agents. */
export function availableBotMentionUsers(
  channelBots: readonly Bot[],
  agents: readonly Agent[],
  cursorConnected: boolean
): IUser[] {
  const globalAgents = agents.filter(
    (agent) =>
      agent.channel_scope === 'all' &&
      agent.bot.has_agent &&
      (agent.harness !== 'cursor' || cursorConnected)
  );
  const seen = new Set<string>();

  return [...channelBots, ...globalAgents.map((agent) => agent.bot)]
    .map(mentionUser)
    .filter((user) => {
      if (seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    });
}

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
  const channelBots = useChannelBotsQuery(channelId);
  const agents = useAgentsQuery();
  const cursorStatus = useCursorApiKeyStatusQuery();

  return createMemo(() =>
    availableBotMentionUsers(
      channelBots.data ?? [],
      agents.data ?? [],
      cursorStatus.data?.registered ?? false
    )
  );
}
