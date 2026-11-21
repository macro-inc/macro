import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  type AgentInbox,
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
/**
 * How often a settled agent is checked again: its computer can stop
 * answering, or recover from a failure, with nothing on this client to cue a
 * refetch.
 */
const SETTLED_POLL_MS = 30_000;

type CreateTeamAgentArgs = {
  teamId: string;
  request: CreateTeamAgent;
  /** The Add flow's span, so the invite joins its trace across the await. */
  parentSpan?: Span;
};
type RemoveTeamAgentArgs = { teamId: string; userId: string };
type AddAgentInboxArgs = { teamId: string; userId: string };

/**
 * Polls fast while an agent's computer is being set up, the agent is
 * starting, or its computer is unhealthy and coming back by itself; slowly
 * while any agent could still change on its own; not at all once every agent
 * is released.
 */
export function teamAgentsPollInterval(
  agents: readonly TeamAgent[] | undefined
): number | false {
  const moving = agents?.some(
    (agent) =>
      agent.status === 'provisioning' ||
      agent.status === 'starting' ||
      agent.status === 'unhealthy' ||
      agent.inbox?.state === 'provisioning'
  );
  if (moving) return PROVISIONING_POLL_MS;
  const live = agents?.some((agent) => agent.status !== 'released');
  return live ? SETTLED_POLL_MS : false;
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

/**
 * The team's agent teammates read now, bypassing the cache's freshness, for
 * a caller waiting on one of them; the list query shows the same answer.
 */
export async function fetchTeamAgents(teamId: string): Promise<TeamAgents> {
  return await queryClient.fetchQuery({
    ...teamAgentsQueryOptions(teamId, true),
    staleTime: 0,
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
  const invite = (span: Span) => inviteTeamAgent(vars, span);
  if (vars.parentSpan)
    return await vars.parentSpan.span('team-agent.invite', invite);
  return await Telemetry.span('team-agent.invite', invite);
}

async function inviteTeamAgent(vars: CreateTeamAgentArgs, span: Span) {
  span.setAttr('team.id', vars.teamId);
  span.setAttr('computer.size', vars.request.size);
  if (vars.request.voice) span.setAttr('voice.model', vars.request.voice);
  try {
    const agent = await throwOnErr(() => teamAgentsClient.create(vars.request));
    span.setAttr('agent.user_id', agent.userId);
    return agent;
  } catch (error) {
    span.error('Agent invitation failed');
    throw error;
  }
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

function storeAgentInbox(teamId: string, userId: string, inbox: AgentInbox) {
  queryClient.setQueryData<TeamAgents>(
    teamAgentKeys.list(teamId).queryKey,
    (current) =>
      current && {
        agents: current.agents.map((agent) =>
          agent.userId === userId ? { ...agent, inbox } : agent
        ),
      }
  );
}

async function addAgentInbox(vars: AddAgentInboxArgs) {
  return await Telemetry.span('team-agent.add-inbox', async (span) => {
    span.setAttr('team.id', vars.teamId);
    const inbox = await throwOnErr(() =>
      teamAgentsClient.addInbox(vars.userId)
    );
    span.setAttr('inbox.state', inbox.state);
    return inbox;
  });
}

/** Gives an agent its own email inbox, or retries a failed one. */
export function useAddAgentInboxMutation() {
  return useMutation(() => ({
    gcTime: 0,
    retry: false,
    mutationFn: addAgentInbox,
    onSuccess: (inbox: AgentInbox, vars: AddAgentInboxArgs) =>
      storeAgentInbox(vars.teamId, vars.userId, inbox),
    onSettled: (
      _inbox: AgentInbox | undefined,
      _error: Error | null,
      vars: AddAgentInboxArgs
    ) =>
      queryClient.invalidateQueries({
        queryKey: teamAgentKeys.list(vars.teamId).queryKey,
      }),
  }));
}
