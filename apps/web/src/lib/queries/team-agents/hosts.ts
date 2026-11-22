import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import {
  type TeamAgent,
  type TeammateHosts,
  teamAgentsClient,
} from '@service-auth/team-agents';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { teammateHostKeys } from './hosts-keys';
import { teamAgentKeys } from './keys';

type MoveTeamAgentArgs = { teamId: string; userId: string; harnessId: string };

/** How often to read the machines again while one's engine didn't answer. */
const UNREACHABLE_ENGINE_POLL_MS = 15_000;

/** Reads again while a machine's engine didn't answer: it may come back by itself. */
function teammateHostsPollInterval(query: {
  state: { data: TeammateHosts | undefined };
}): number | false {
  const unreachable = query.state.data?.hosts.some(
    (host) =>
      !host.eligibility.ok && host.eligibility.reason === 'engineUnreachable'
  );
  return unreachable ? UNREACHABLE_ENGINE_POLL_MS : false;
}

function teammateHostsQueryOptions(teamId: string, enabled: boolean) {
  return {
    queryKey: teammateHostKeys.list(teamId).queryKey,
    enabled: enabled && !!teamId,
    queryFn: () => throwOnErr(teamAgentsClient.hosts),
    staleTime: 0,
    refetchInterval: teammateHostsPollInterval,
  };
}

/**
 * The caller's own paired machines, and whether each can host an agent now.
 * Read when the Invite or Move dialog opens; machines come and go.
 */
export function useTeammateHostsQuery(
  teamId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => teammateHostsQueryOptions(teamId(), enabled()));
}

async function moveTeamAgent(vars: MoveTeamAgentArgs): Promise<TeamAgent> {
  return await Telemetry.span('team-agent.move', async (span) => {
    span.setAttr('team.id', vars.teamId);
    span.setAttr('agent.user_id', vars.userId);
    span.setAttr('harness.id', vars.harnessId);
    return await throwOnErr(() =>
      teamAgentsClient.move(vars.userId, vars.harnessId)
    );
  });
}

async function refreshAfterMove(teamId: string) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: teamAgentKeys.list(teamId).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: teammateHostKeys.list(teamId).queryKey,
    }),
  ]);
}

/** Move an agent to another of the caller's machines. */
export function useMoveTeamAgentMutation() {
  return useMutation(() => ({
    gcTime: 0,
    retry: false,
    mutationFn: moveTeamAgent,
    onSettled: (
      _agent: TeamAgent | undefined,
      _error: Error | null,
      vars: MoveTeamAgentArgs
    ) => refreshAfterMove(vars.teamId),
  }));
}
