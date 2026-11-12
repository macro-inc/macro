import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import {
  type CreateTeamAgent,
  type TeamAgent,
  type TeamAgents,
  teamAgentsClient,
} from '@service-auth/team-agents';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { invalidateAiBillingSummary } from '../auth';
import { queryClient } from '../client';
import { computerKeys } from '../computers/keys';
import { invalidateTeam } from '../team/teams';
import { teamAgentKeys } from './keys';

const PROVISIONING_POLL_MS = 3_000;

type CreateTeamAgentArgs = { teamId: string; request: CreateTeamAgent };
type RemoveTeamAgentArgs = { teamId: string; userId: string };

/** Polls only while an agent's computer is still being set up. */
export function teamAgentsPollInterval(
  agents: readonly TeamAgent[] | undefined
): number | false {
  const provisioning = agents?.some((agent) => agent.status === 'provisioning');
  return provisioning ? PROVISIONING_POLL_MS : false;
}

// Cached callbacks outlive the hooks; keep hook scope out of these closures.
function teamAgentsQueryOptions(teamId: string, enabled: boolean) {
  return queryOptions({
    queryKey: teamAgentKeys.list(teamId).queryKey,
    enabled: enabled && !!teamId,
    queryFn: () => throwOnErr(teamAgentsClient.list),
    reconcile: 'userId',
    refetchInterval: (query) =>
      thrownResultErrorHasCode(query.state.error, 'UNAUTHORIZED')
        ? false
        : teamAgentsPollInterval(query.state.data?.agents),
  });
}

/** The team's agent teammates, oldest first; any member can read them. */
export function useTeamAgentsQuery(
  teamId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => teamAgentsQueryOptions(teamId(), enabled()));
}

async function invalidateAfterAgentChange(teamId: string) {
  // The agent is a team member with its own computer on the subscription.
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: teamAgentKeys.list(teamId).queryKey,
    }),
    invalidateTeam(teamId),
    queryClient.invalidateQueries({ queryKey: computerKeys.list.queryKey }),
    queryClient.invalidateQueries({ queryKey: computerKeys.offers.queryKey }),
    invalidateAiBillingSummary(),
  ]);
}

function storeCreatedAgent(teamId: string, agent: TeamAgent) {
  queryClient.setQueryData<TeamAgents>(
    teamAgentKeys.list(teamId).queryKey,
    (current) => ({
      agents: [
        ...(current?.agents ?? []).filter(
          (item) => item.userId !== agent.userId
        ),
        agent,
      ],
    })
  );
}

function forgetAgent(teamId: string, userId: string) {
  queryClient.setQueryData<TeamAgents>(
    teamAgentKeys.list(teamId).queryKey,
    (current) =>
      current && {
        agents: current.agents.filter((agent) => agent.userId !== userId),
      }
  );
}

async function createTeamAgent(vars: CreateTeamAgentArgs) {
  return await Telemetry.span('team-agent.invite', async (span) => {
    span.setAttr('team.id', vars.teamId);
    span.setAttr('computer.size', vars.request.size);
    if (vars.request.voice) span.setAttr('voice.model', vars.request.voice);
    try {
      const agent = await throwOnErr(() =>
        teamAgentsClient.create(vars.request)
      );
      span.setAttr('agent.user_id', agent.userId);
      return agent;
    } catch (error) {
      span.error('Agent invitation failed');
      throw error;
    }
  });
}

export function useCreateTeamAgentMutation() {
  return useMutation(() => ({
    gcTime: 0,
    retry: false,
    mutationFn: createTeamAgent,
    onSuccess: (agent: TeamAgent, vars: CreateTeamAgentArgs) =>
      storeCreatedAgent(vars.teamId, agent),
    onSettled: (
      _agent: TeamAgent | undefined,
      _error: Error | null,
      vars: CreateTeamAgentArgs
    ) => invalidateAfterAgentChange(vars.teamId),
  }));
}

async function removeTeamAgent(vars: RemoveTeamAgentArgs) {
  return await Telemetry.span('team-agent.remove', async (span) => {
    span.setAttr('team.id', vars.teamId);
    span.setAttr('agent.user_id', vars.userId);
    await throwOnErr(() => teamAgentsClient.remove(vars.userId));
  });
}

export function useRemoveTeamAgentMutation() {
  return useMutation(() => ({
    gcTime: 0,
    retry: false,
    mutationFn: removeTeamAgent,
    onSuccess: (_data: void, vars: RemoveTeamAgentArgs) =>
      forgetAgent(vars.teamId, vars.userId),
    onSettled: (
      _data: void | undefined,
      _error: Error | null,
      vars: RemoveTeamAgentArgs
    ) => invalidateAfterAgentChange(vars.teamId),
  }));
}
