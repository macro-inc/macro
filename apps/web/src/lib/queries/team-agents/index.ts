import { throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
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
    refetchInterval: (query) => {
      const agents = query.state.data?.agents ?? [];
      if (agents.length === 0) return false;
      return agents.some((agent) => agent.status === 'provisioning')
        ? 3000
        : 30000;
    },
    refetchIntervalInBackground: false,
  });
}

export function teamAgentSizesQueryOptions(teamId: string) {
  return queryOptions({
    queryKey: teamAgentKeys.sizes(teamId).queryKey,
    queryFn: () =>
      Telemetry.span('team-agent.sizes.load', (span) => {
        span.setAttr('team.id', teamId);
        return throwOnErr(async () => {
          const result = await authServiceClient.getTeamAgentSizes();
          if (result.isErr()) span.error('Agent size catalog request failed');
          return result;
        });
      }),
    staleTime: Infinity,
  });
}

export function useTeamAgentSizesQuery(teamId: Accessor<string>) {
  return useQuery(() => teamAgentSizesQueryOptions(teamId()));
}

function teamAgentComputerQueryOptions(userId: string, enabled: boolean) {
  return queryOptions({
    queryKey: teamAgentKeys.computer(userId).queryKey,
    enabled: enabled && !!userId,
    queryFn: () =>
      Telemetry.span('team-agent.computer.load', () =>
        throwOnErr(() => authServiceClient.getTeamAgentComputer(userId))
      ),
    staleTime: 15000,
    retry: false,
    throwOnError: false,
  });
}

/** Portrait cards discover the target's computer only while an agent card is open. */
export function useTeamAgentComputerQuery(
  userId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return useQuery(() =>
    teamAgentComputerQueryOptions(userId() ?? '', enabled())
  );
}

/** A click-only lookup; keep discovery out of component transport code. */
export function useTeamAgentComputerMutation() {
  return useMutation(() => ({
    gcTime: 0,
    retry: false,
    mutationFn: ({
      userId,
      parentSpan,
    }: {
      userId: string;
      parentSpan?: Span;
    }) => {
      const load = async (span: Span) => {
        const computer = await throwOnErr(async () => {
          const result = await authServiceClient.getTeamAgentComputer(userId);
          if (result.isErr()) span.error('Agent computer lookup failed');
          return result;
        });
        span.setAttr('computer.id', computer.computerId);
        if (computer.harnessId) span.setAttr('harness.id', computer.harnessId);
        return computer;
      };
      return parentSpan
        ? parentSpan.span('team-agent.computer.load', load)
        : Telemetry.span('team-agent.computer.load', load);
    },
  }));
}

export function teamAgentQuoteQueryOptions(teamId: string, size: ComputerSize) {
  return queryOptions({
    queryKey: teamAgentKeys.quote(teamId, size).queryKey,
    queryFn: () =>
      Telemetry.span('team-agent.quote.load', (span) => {
        span.setAttr('team.id', teamId);
        span.setAttr('computer.size', size);
        return throwOnErr(async () => {
          const result = await authServiceClient.quoteTeamAgent(size);
          if (result.isErr()) span.error('Agent price quote request failed');
          return result;
        });
      }),
    staleTime: 0,
    retry: false,
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
      parentSpan,
    }: {
      teamId: string;
      request: CreateTeamAgent;
      parentSpan?: Span;
    }) => {
      const create = () =>
        Telemetry.span('team-agent.invite', (span) => {
          span.setAttr('team.id', teamId);
          span.setAttr('computer.size', request.size);
          return throwOnErr(async () => {
            const result = await authServiceClient.createTeamAgent(request);
            if (result.isErr()) span.error('Agent invitation request failed');
            return result;
          });
        });
      return parentSpan ? parentSpan.run(create) : create();
    },
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
