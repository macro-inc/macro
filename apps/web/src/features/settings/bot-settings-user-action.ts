import { requestBotDetail } from '@app/features/channel/Bots/botSettingsState';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import type { UserCardAction } from '@core/component/userCardActions';
import { botManagement, enableChatV3Agents } from '@core/constant/featureFlags';
import { isBotPrincipalId, isMacroAgentId } from '@core/constant/macroAgent';
import { isMacroNewId } from '@core/constant/macroNew';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import GearIcon from '@phosphor/gear.svg';
import { useAgentsQuery } from '@queries/agents/agents';
import { useBotsQuery } from '@queries/bots/bots';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import { canManageAgent } from '../channel/Bots/botPermissions';
import { requestAgentDetail } from './agentSettingsState';

type BotSettingsDestination =
  | { type: 'agents' }
  | { type: 'agent'; agentId: string }
  | { type: 'bot'; botId: string };

/**
 * The user card's way into Settings for an agent or bot: the agent's editor
 * when the viewer can configure it, the bot's page under Bots otherwise, and
 * the Agents list for Macro, which has no editor of its own.
 */
export function createBotSettingsUserCardAction(
  principalId: Accessor<string | undefined>
): Accessor<UserCardAction | undefined> {
  const agentsFlag = useFeatureFlag(enableChatV3Agents);
  const botsFlag = useFeatureFlag(botManagement);
  const { openSettings } = useSettingsState();
  const currentUserId = useUserId();
  const isBot = () => isBotPrincipalId(principalId());
  // Only a bot's card needs these lists, so a person's card never fetches
  // them. Guarded reads: an unguarded `data` suspends the card.
  const agentsQuery = useAgentsQuery(() => isBot() && agentsFlag().enabled);
  const botsQuery = useBotsQuery(() => isBot() && botsFlag().enabled);
  const currentTeamQuery = useCurrentTeamQuery(
    () => isBot() && agentsFlag().enabled
  );

  const destination = (): BotSettingsDestination | undefined => {
    const id = principalId();
    if (!id || !isBot()) return undefined;
    const botId = id.startsWith('bot|') ? id.slice('bot|'.length) : id;

    if (agentsFlag().enabled) {
      if (isMacroAgentId(botId) || isMacroNewId(botId)) {
        return { type: 'agents' };
      }
      const agents = agentsQuery.isSuccess ? agentsQuery.data : [];
      const teamId = currentTeamQuery.isSuccess
        ? currentTeamQuery.data?.team.id
        : undefined;
      const agent = agents.find((candidate) => candidate.bot.id === botId);
      if (agent) {
        return canManageAgent(agent.bot, currentUserId(), teamId)
          ? { type: 'agent', agentId: botId }
          : undefined;
      }
    }

    const bots =
      botsFlag().enabled && botsQuery.isSuccess ? botsQuery.data : [];
    if (bots.some((bot) => bot.id === botId)) return { type: 'bot', botId };
    return undefined;
  };

  const open = (event: MouseEvent, target: BotSettingsDestination) => {
    event.preventDefault();
    event.stopPropagation();
    match(target)
      .with({ type: 'agents' }, () => openSettings('Agents'))
      .with({ type: 'agent' }, ({ agentId }) => {
        requestAgentDetail(agentId);
        openSettings('Agents');
      })
      .with({ type: 'bot' }, ({ botId }) => {
        requestBotDetail(botId);
        openSettings('Bots');
      })
      .exhaustive();
  };

  return () => {
    const target = destination();
    return target
      ? {
          id: 'open-settings',
          label: 'Settings',
          icon: GearIcon,
          onSelect: (event) => open(event, target),
        }
      : undefined;
  };
}
