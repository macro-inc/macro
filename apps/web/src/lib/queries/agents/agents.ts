import { throwOnErr } from '@core/util/result';
import { botKeys } from '@queries/bots/keys';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { Agent } from '@service-storage/generated/schemas/agent';
import type { AgentChannelScope } from '@service-storage/generated/schemas/agentChannelScope';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { agentKeys } from './keys';

/**
 * `Agent` plus the macrod harness binding the backend now returns; the field
 * is not yet in the generated schema.
 */
export type AgentWithHarnessId = Agent & { harness_id?: string | null };

export type CreateAgentParams = {
  avatarUrl?: string;
  channelIds: string[];
  channelScope: AgentChannelScope;
  defaultModel: string;
  description?: string;
  handle: string;
  harness: string;
  /** The registered macrod harness to run on; omit for built-in harnesses. */
  harnessId?: string;
  name: string;
  instructions: string;
  teamId?: string;
};

export type UpdateAgentParams = CreateAgentParams & {
  agentId: string;
};

export type DeleteAgentParams = {
  agentId: string;
  channelIds: string[];
};

export function useAgentsQuery() {
  return useQuery(() => ({
    queryKey: agentKeys.list.queryKey,
    queryFn: async (): Promise<AgentWithHarnessId[]> =>
      await throwOnErr(() => storageServiceClient.getAgents()),
  }));
}

export function invalidateAgents() {
  return queryClient.invalidateQueries({ queryKey: agentKeys.list.queryKey });
}

function invalidateAgentChannelBots(channelIds: string[]) {
  return Promise.all(
    [...new Set(channelIds)].map((channelId) =>
      queryClient.invalidateQueries({
        queryKey: channelKeys.channelBots(channelId).queryKey,
      })
    )
  );
}

export function useCreateAgentMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: CreateAgentParams) =>
      await throwOnErr(() =>
        storageServiceClient.createAgent({
          avatar_url: vars.avatarUrl,
          channel_ids: vars.channelIds,
          channel_scope: vars.channelScope,
          default_model: vars.defaultModel,
          description: vars.description,
          handle: vars.handle,
          harness: vars.harness,
          harness_id: vars.harnessId,
          name: vars.name,
          instructions: vars.instructions,
          team_id: vars.teamId,
        })
      ),
    onSuccess: async (agent) => {
      queryClient.setQueryData<Agent[]>(
        agentKeys.list.queryKey,
        (current = []) => [...current, agent]
      );
      await invalidateAgentChannelBots(agent.channel_ids);
    },
    onError: (error) => console.error('failed to create agent', error),
  }));
}

export function useUpdateAgentMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: UpdateAgentParams) =>
      await throwOnErr(() =>
        storageServiceClient.updateAgent({
          agent_id: vars.agentId,
          avatar_url: vars.avatarUrl,
          channel_ids: vars.channelIds,
          channel_scope: vars.channelScope,
          default_model: vars.defaultModel,
          description: vars.description,
          handle: vars.handle,
          harness: vars.harness,
          harness_id: vars.harnessId,
          name: vars.name,
          instructions: vars.instructions,
          team_id: vars.teamId,
        })
      ),
    onSuccess: async (updated) => {
      const previousChannelIds =
        queryClient
          .getQueryData<Agent[]>(agentKeys.list.queryKey)
          ?.find((agent) => agent.bot.id === updated.bot.id)?.channel_ids ?? [];
      queryClient.setQueryData<Agent[]>(
        agentKeys.list.queryKey,
        (current = []) =>
          current.map((agent) =>
            agent.bot.id === updated.bot.id ? updated : agent
          )
      );
      await invalidateAgentChannelBots([
        ...previousChannelIds,
        ...updated.channel_ids,
      ]);
    },
    onError: (error) => console.error('failed to update agent', error),
  }));
}

export function useDeleteAgentMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: DeleteAgentParams) =>
      await throwOnErr(() =>
        storageServiceClient.deleteBot({ bot_id: vars.agentId })
      ),
    onSuccess: async (_data, vars) => {
      queryClient.setQueryData<Agent[]>(
        agentKeys.list.queryKey,
        (current = []) =>
          current.filter((agent) => agent.bot.id !== vars.agentId)
      );
      queryClient.removeQueries({
        queryKey: botKeys.detail(vars.agentId).queryKey,
      });
      queryClient.removeQueries({
        queryKey: botKeys.channels(vars.agentId).queryKey,
      });
      queryClient.removeQueries({
        queryKey: botKeys.tokens(vars.agentId).queryKey,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: botKeys.list.queryKey }),
        ...[...new Set(vars.channelIds)].flatMap((channelId) => [
          queryClient.invalidateQueries({
            queryKey: channelKeys.channelBots(channelId).queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: channelKeys.participants(channelId).queryKey,
          }),
        ]),
      ]);
    },
    onError: (error) => console.error('failed to delete agent', error),
  }));
}
