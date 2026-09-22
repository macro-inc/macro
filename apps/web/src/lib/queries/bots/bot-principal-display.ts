import { isBotPrincipalId } from '@core/constant/macroAgent';
import { useAgentsQuery } from '@queries/agents/agents';
import { queryReadyGate } from '@queries/gate';
import { firstPartyBotName } from './first-party-bot-name';

export type BotPrincipalDisplay = {
  name: string;
  avatarUrl?: string;
};

/**
 * Presentation for a `bot|<uuid>` principal appearing where a person usually
 * does — an agent assigned to a task, for instance. First-party agents resolve
 * from constants, so they render before the roster loads.
 *
 * Returns undefined for anything that is not a bot principal, so callers can
 * fall through to their normal person handling.
 */
export function useBotPrincipalDisplay(): (
  principalId: string
) => BotPrincipalDisplay | undefined {
  const agents = useAgentsQuery();

  return (principalId: string) => {
    if (!isBotPrincipalId(principalId)) return undefined;

    const botId = principalId.startsWith('bot|')
      ? principalId.slice('bot|'.length)
      : principalId;
    const agent = (queryReadyGate(agents) ? agents.data : []).find(
      (candidate) => candidate.bot.id === botId
    );
    if (agent) {
      return {
        name: agent.bot.name,
        avatarUrl: agent.bot.avatar_url ?? undefined,
      };
    }
    return { name: firstPartyBotName(principalId) ?? 'Agent' };
  };
}
