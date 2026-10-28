import { useAgentMentionUsers } from '@channel/use-agent-mention-users';
import { isMacroAgentId } from '@core/constant/macroAgent';
import type { IUser } from '@core/user';
import { useAgentsQuery } from '@queries/agents/agents';
import { useBotsQuery } from '@queries/bots/bots';
import { queryReadyGate } from '@queries/gate';
import type { Accessor } from 'solid-js';

/** Agents use their canonical bot principal in the USER assignee property. */
export function useAgentAssignees(
  enabled: Accessor<boolean>
): Accessor<IUser[]> {
  const agents = useAgentsQuery(enabled);
  // The agent list also includes agents visible through shared channels.
  // The bot list is scoped to the caller's own and team bots, which are the
  // principals they may invoke from a task outside those channels.
  const bots = useBotsQuery(enabled);
  const savedAgents = () => {
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
  // Reuse the message composer's system-agent roster and rollout policy.
  // Classic Macro replies inline without a session, so it cannot be assigned.
  const available = useAgentMentionUsers(savedAgents, enabled);
  return () => available().filter((agent) => !isMacroAgentId(agent.id));
}
