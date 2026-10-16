import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import { useUserId } from '@core/context/user';
import { type CombinedRecipientItem, recipientEntityMapper } from '@core/user';
import { useAgentsQuery } from '@queries/agents/agents';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createMemo } from 'solid-js';
import { canDirectMessagePersona } from './core/personas';

/** Production composition for the new-message picker's agent recipients. */
export function useAgentDmRecipients() {
  const userId = useUserId();
  const team = useCurrentTeamQuery();
  const agents = useAgentsQuery();
  return createMemo<CombinedRecipientItem<'agent'>[]>(() => {
    const teamId = team.isSuccess ? team.data?.team.id : undefined;
    const visibleAgents = agents.isSuccess ? agents.data : [];
    return [
      recipientEntityMapper('agent')({
        id: MACRO_NEW_BOT_ID,
        name: 'Macro',
        handle: 'macro',
        description: 'Your private conversation with Macro',
      }),
      ...visibleAgents
        .filter((agent) =>
          canDirectMessagePersona(agent.bot.owner, userId(), teamId)
        )
        .map((agent) => recipientEntityMapper('agent')(agent.bot)),
    ];
  });
}
