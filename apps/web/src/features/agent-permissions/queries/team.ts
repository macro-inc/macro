import { throwOnErr } from '@core/util/result';
import type { TraceContext } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import type {
  TeamToolPermissions,
  ToolPermissionChange,
} from '@service-agent-harness/generated/schemas';
import { toolPermissionsClient } from '@service-agent-harness/tool-permissions';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentToolPermissionKeys } from './keys';
import { followsAPolicy, orUnavailable } from './permissions';

export function teamToolPermissionsQueryOptions(
  teamId: string,
  enabled: boolean
) {
  return queryOptions({
    queryKey: agentToolPermissionKeys.team(teamId).queryKey,
    queryFn: () =>
      orUnavailable(() => throwOnErr(() => toolPermissionsClient.team(teamId))),
    enabled,
    refetchOnWindowFocus: true,
  });
}

/** A team's default permissions; `null` when unavailable (not a member, or the feature is off). */
export function useTeamToolPermissionsQuery(
  teamId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => teamToolPermissionsQueryOptions(teamId(), enabled()));
}

/**
 * Agents following the team default resolve through it, so their views,
 * the policy previews and the candidates are read again.
 */
function storeTeamView(view: TeamToolPermissions) {
  queryClient.setQueryData(
    agentToolPermissionKeys.team(view.teamId).queryKey,
    view
  );
  queryClient.invalidateQueries({
    queryKey: agentToolPermissionKeys.agent._def,
    predicate: (query) => followsAPolicy(query.state.data),
  });
  queryClient.invalidateQueries({
    queryKey: agentToolPermissionKeys.policy._def,
  });
}

export type SetTeamPermissionsVariables = {
  teamId: string;
  changes: ToolPermissionChange[];
  trace?: TraceContext;
};

export type ResetTeamPermissionsVariables = {
  teamId: string;
  trace?: TraceContext;
};

function setTeamMutationOptions(teamId: string) {
  return {
    // One queue per team, so clicks reach the server in the order made.
    scope: { id: `team-tool-permissions:${teamId}` },
    onMutate: () =>
      queryClient.cancelQueries({
        queryKey: agentToolPermissionKeys.team(teamId).queryKey,
      }),
    mutationFn: (variables: SetTeamPermissionsVariables) =>
      throwOnErr(() =>
        toolPermissionsClient.setTeam(
          variables.teamId,
          { changes: variables.changes },
          variables.trace
        )
      ),
    onSuccess: storeTeamView,
  };
}

function resetTeamMutationOptions(teamId: string) {
  return {
    scope: { id: `team-tool-permissions:${teamId}` },
    onMutate: () =>
      queryClient.cancelQueries({
        queryKey: agentToolPermissionKeys.team(teamId).queryKey,
      }),
    mutationFn: (variables: ResetTeamPermissionsVariables) =>
      throwOnErr(() =>
        toolPermissionsClient.resetTeam(variables.teamId, variables.trace)
      ),
    onSuccess: storeTeamView,
  };
}

export function useSetTeamPermissionsMutation(teamId: Accessor<string>) {
  return useMutation(() => setTeamMutationOptions(teamId()));
}

export function useResetTeamPermissionsMutation(teamId: Accessor<string>) {
  return useMutation(() => resetTeamMutationOptions(teamId()));
}
