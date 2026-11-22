import type { IUser } from '@core/user/types';
import { useAgentsQuery } from '@queries/agents/agents';
import { useBotsQuery } from '@queries/bots/bots';
import { queryReadyGate } from '@queries/gate';
import type { Accessor } from 'solid-js';
import { useAgentMentionUserTransform } from './use-agent-mention-users';

/**
 * The agents the viewer owns or shares through a team, as `bot|<uuid>` mention
 * principals. They need no contact history to be mentionable: a new account
 * can mention the agent it just created.
 *
 * The agent list also includes agents visible through shared channels. The bot
 * list is scoped to the caller's own and team bots, which are the principals
 * they may invoke outside those channels, so an agent counts only when both
 * lists have it.
 */
export function useOwnAgentMentionUsers(
  enabled: Accessor<boolean> = () => true
): Accessor<IUser[]> {
  const agents = useAgentsQuery(enabled);
  const bots = useBotsQuery(enabled);
  return () => {
    if (!enabled() || !queryReadyGate(agents) || !queryReadyGate(bots))
      return [];
    const availableIds = new Set(bots.data.map((bot) => bot.id));
    return agents.data
      .filter(
        ({ bot }) =>
          bot.has_agent && !bot.deleted_at && availableIds.has(bot.id)
      )
      .map(({ bot }) => ({
        id: `bot|${bot.id}`,
        name: bot.name,
        email: `@${bot.handle}`,
        photoUrl: bot.avatar_url ?? undefined,
      }));
  };
}

/**
 * A mention-list transform for composers whose `@` menu reads the personal
 * contact directory: Macro and the viewer's own and team agents are offered
 * whatever the directory holds, and listed once when it has them too.
 */
export function useOwnAgentMentionTransform(
  enabled: Accessor<boolean> = () => true
): (users: readonly IUser[]) => IUser[] {
  const own = useOwnAgentMentionUsers(enabled);
  const withAgents = useAgentMentionUserTransform(enabled);
  return (users) => withAgents([...users, ...own()]);
}
