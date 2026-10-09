import { throwOnErr } from '@core/util/result';
import { listAgentConversations } from '@service-agent-harness/agent-conversations';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export const agentConversationsKey = (channelId: string) =>
  ['agent-conversations', channelId] as const;

/** Only the open channel polls for context and eligibility changes. */
export function useAgentConversations(channelId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: agentConversationsKey(channelId()),
    queryFn: ({ signal }) =>
      throwOnErr(() => listAgentConversations(channelId(), signal)),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  }));
}
