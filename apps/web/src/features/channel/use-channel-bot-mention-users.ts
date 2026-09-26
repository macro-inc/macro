import { isCursorBotId } from '@core/constant/cursorAgent';
import { useCursorAgentsAccess } from '@core/cursor/flag';
import type { IUser } from '@core/user/types';
import { useAgentsQuery } from '@queries/agents/agents';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import { queryReadyGate } from '@queries/gate';
import type { Agent } from '@service-storage/generated/schemas/agent';
import type { Bot } from '@service-storage/generated/schemas/bot';
import type { MessageParent } from '@service-storage/messages';
import { type Accessor, createMemo } from 'solid-js';

function mentionUser(bot: Bot): IUser {
  return {
    id: `bot|${bot.id}`,
    name: bot.name,
    email: bot.name,
    photoUrl: bot.avatar_url ?? undefined,
  };
}

/**
 * Build mention entries from installed channel bots and virtual global
 * agents. Account setup does not hide a mention: the harness answers with
 * a connection prompt in the thread when setup is needed. The built-in
 * Cursor entry follows the Cursor rollout flag.
 */
export function availableBotMentionUsers(
  channelBots: readonly Bot[],
  agents: readonly Agent[],
  cursorEnabled: boolean,
  surface: MessageParent['type'] = 'channel'
): IUser[] {
  const globalAgents = agents.filter(
    (agent) =>
      (surface !== 'channel' || agent.channel_scope === 'all') &&
      agent.bot.has_agent
  );
  const seen = new Set<string>();

  return [...channelBots, ...globalAgents.map((agent) => agent.bot)]
    .filter((bot) => cursorEnabled || !isCursorBotId(bot.id))
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
 * send time (see `authoredMentions`).
 */
export function useMessageBotMentionUsers(
  parent: Accessor<MessageParent>
): Accessor<IUser[]> {
  const channelBots = useChannelBotsQuery(() =>
    parent().type === 'channel' ? parent().id : ''
  );
  const agents = useAgentsQuery();
  const canUseCursor = useCursorAgentsAccess();

  return createMemo(() =>
    availableBotMentionUsers(
      queryReadyGate(channelBots) ? channelBots.data : [],
      queryReadyGate(agents) ? agents.data : [],
      canUseCursor(),
      parent().type
    )
  );
}
