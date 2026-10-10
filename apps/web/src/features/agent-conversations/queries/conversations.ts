import { throwOnErr } from '@core/util/result';
import { listAgentConversations } from '@service-agent-harness/agent-conversations';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export const agentConversationsKey = (channelId: string) =>
  ['agent-conversations', channelId] as const;

function agentConversationsQueryOptions(channelId: string, enabled: boolean) {
  return queryOptions({
    queryKey: agentConversationsKey(channelId),
    queryFn: ({ signal }) =>
      throwOnErr(() => listAgentConversations(channelId, signal)),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/**
 * Only the open channel polls for context and eligibility changes, and only
 * while `enabled` says an agent converses there.
 */
export function useAgentConversations(
  channelId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => agentConversationsQueryOptions(channelId(), enabled()));
}
