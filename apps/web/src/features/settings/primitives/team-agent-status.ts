import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { enableAgentTeammates } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { computerKeys } from '@queries/computers/keys';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { teamAgentKeys } from '@queries/team-agents/keys';
import { useTeamAgentsQuery } from '@queries/team-agents/team-agents';
import { computersClient } from '@service-auth/computers';
import type { TeamAgent } from '@service-auth/team-agents';
import { type Accessor, createSignal } from 'solid-js';
import { agentComputerHarness } from '../core/team-agent-claude';
import {
  type TeamAgentRunState,
  teamAgentRunState,
} from '../core/team-agent-setup';

/**
 * Whether the agent teammate `userId` names can answer, from the same
 * sources as its row in Members: the team's agents (its computer's state)
 * and the harness list (whether macrod is connected). `agent` is undefined
 * for anyone who is not one of the team's agent teammates.
 */
export function useTeamAgentStatus(userId: Accessor<string | undefined>) {
  const flag = useFeatureFlag(enableAgentTeammates);
  const enabled = () => !!userId() && !flag().loading && flag().enabled;
  const team = useCurrentTeamQuery(enabled);
  const agents = useTeamAgentsQuery(
    // No team (null) has no agents; the query stays off without an id.
    () => (team.isSuccess ? (team.data?.team.id ?? '') : ''),
    enabled
  );
  const harnesses = useHarnessesQuery();

  const agent = (): TeamAgent | undefined => {
    if (!enabled() || !agents.isSuccess) return undefined;
    return agents.data.agents.find((item) => item.userId === userId());
  };

  const state = (): TeamAgentRunState | undefined => {
    const current = agent();
    if (!current) return undefined;
    const harness = agentComputerHarness(
      current.computerId,
      harnesses.isSuccess ? harnesses.data : undefined
    );
    return teamAgentRunState(current, harness);
  };

  return { agent, state };
}

/**
 * Sets a team agent's failed computer up again: the computer's own retry, on
 * the computer the invite bought, so it never buys a second one. Callable
 * outside components, for the failure notice's Retry.
 */
export async function retryTeamAgentComputer(computerId: string) {
  await throwOnErr(() => computersClient.retry(computerId));
  // The agent's status comes from its computer; both lists poll again
  // while it is being set up.
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: computerKeys.list.queryKey }),
    queryClient.invalidateQueries({ queryKey: teamAgentKeys.list._def }),
  ]);
}

/** Retry for an agent's row and DM, with its pending state and failure toast. */
export function useRetryTeamAgentSetup() {
  const [pending, setPending] = createSignal(false);

  const run = async (agent: TeamAgent) => {
    if (!agent.computerId || pending()) return;
    setPending(true);
    try {
      await retryTeamAgentComputer(agent.computerId);
    } catch {
      toast.failure(t('teamAgents.retryFailed', { name: agent.name }));
    } finally {
      setPending(false);
    }
  };

  return { run, pending };
}
