import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import { useUserId } from '@core/context/user';
import { type CombinedRecipientItem, recipientEntityMapper } from '@core/user';
import { useAgentsQuery } from '@queries/agents/agents';
import { useLiveRestBots } from '@queries/bots/live-rest-bots';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createMemo } from 'solid-js';
import { canDirectMessagePersona } from './core/personas';

/** Production composition for the new-message picker's agent recipients. */
export function useAgentDmRecipients() {
  const userId = useUserId();
  const team = useCurrentTeamQuery();
  const agents = useAgentsQuery();
  // Config decides who can be messaged; names and pictures as they are now.
  const agentBots = useLiveRestBots(() =>
    (agents.isSuccess ? agents.data : []).map((agent) => agent.bot)
  );
  return createMemo<CombinedRecipientItem<'agent'>[]>(() => {
    const teamId = team.isSuccess ? team.data?.team.id : undefined;
    return [
      recipientEntityMapper('agent')({
        id: MACRO_NEW_BOT_ID,
        name: 'Macro',
        handle: 'macro',
        description: 'Your private conversation with Macro',
      }),
      ...agentBots()
        .filter((bot) => canDirectMessagePersona(bot.owner, userId(), teamId))
        .map((bot) => recipientEntityMapper('agent')(bot)),
    ];
  });
}
