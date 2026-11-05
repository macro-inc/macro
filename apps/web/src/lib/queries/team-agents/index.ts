import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { authServiceClient } from '@service-auth/client';
import type {
  ComputerSize,
  CreateTeamAgent,
  TeamAgents,
} from '@service-auth/generated/schemas';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  invalidateAiBillingSummary,
  invalidateSubscriptionStatus,
} from '../auth';
import { queryClient } from '../client';
import { invalidateTeam } from '../team/teams';
import { teamAgentKeys } from './keys';

export function teamAgentsQueryOptions(teamId: string) {
  return queryOptions({
    queryKey: teamAgentKeys.list(teamId).queryKey,
    queryFn: () => throwOnErr(() => authServiceClient.listTeamAgents()),
    reconcile: 'userId',
    refetchInterval: (query) =>
      query.state.data?.agents.some((agent) => agent.status === 'provisioning')
        ? 3000
        : false,
  });
}

export function teamAgentQuoteQueryOptions(teamId: string, size: ComputerSize) {
  return queryOptions({
    queryKey: teamAgentKeys.quote(teamId, size).queryKey,
    queryFn: () => throwOnErr(() => authServiceClient.quoteTeamAgent(size)),
    staleTime: 0,
  });
}

export function useTeamAgentsQuery(
  teamId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    ...teamAgentsQueryOptions(teamId()),
    enabled: enabled(),
  }));
}

export function useTeamAgentQuoteQuery(
  teamId: Accessor<string>,
  size: Accessor<ComputerSize>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    ...teamAgentQuoteQueryOptions(teamId(), size()),
    enabled: enabled(),
  }));
}

export async function invalidateTeamAgents(teamId: string) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: teamAgentKeys.list(teamId).queryKey,
    }),
    invalidateTeam(teamId),
    invalidateAiBillingSummary(),
    invalidateSubscriptionStatus(),
  ]);
}

export function useCreateTeamAgentMutation() {
  return useMutation(() => ({
    retry: false,
    mutationFn: ({
      teamId,
      request,
    }: {
      teamId: string;
      request: CreateTeamAgent;
    }) =>
      Telemetry.span('team-agent.invite', (span) => {
        span.setAttr('team.id', teamId);
        return throwOnErr(() => authServiceClient.createTeamAgent(request));
      }),
    onSuccess: (agent, { teamId }) => {
      queryClient.setQueryData<TeamAgents>(
        teamAgentKeys.list(teamId).queryKey,
        (old) => ({
          agents: [
            ...(old?.agents ?? []).filter(
              (item) => item.userId !== agent.userId
            ),
            agent,
          ],
        })
      );
    },
    onSettled: (_data, _error, { teamId }) => invalidateTeamAgents(teamId),
  }));
}

export function useDeleteTeamAgentMutation() {
  return useMutation(() => ({
    retry: false,
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
      Telemetry.span('team-agent.remove', (span) => {
        span.setAttr('team.id', teamId);
        span.setAttr('agent.id', userId);
        return throwOnErr(() => authServiceClient.deleteTeamAgent(userId));
      }),
    onSettled: (_data, _error, { teamId }) => invalidateTeamAgents(teamId),
  }));
}

export function useRetryTeamAgentMutation() {
  return useMutation(() => ({
    retry: false,
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
      Telemetry.span('team-agent.retry', (span) => {
        span.setAttr('team.id', teamId);
        span.setAttr('agent.id', userId);
        return throwOnErr(() => authServiceClient.retryTeamAgent(userId));
      }),
    onSuccess: (agent, { teamId }) => {
      queryClient.setQueryData<TeamAgents>(
        teamAgentKeys.list(teamId).queryKey,
        (old) => ({
          agents: (old?.agents ?? []).map((item) =>
            item.userId === agent.userId ? agent : item
          ),
        })
      );
    },
    onSettled: (_data, _error, { teamId }) => invalidateTeamAgents(teamId),
  }));
}
