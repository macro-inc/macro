import { throwOnErr } from '@core/util/result';
import { getAgentDm } from '@service-agent-harness/direct-messages';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export const agentDmKey = (channelId: string) =>
  ['agent-dms', channelId] as const;

/** Only the open conversation polls for context and eligibility changes. */
export function useAgentDmConversation(channelId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: agentDmKey(channelId()),
    queryFn: ({ signal }) => throwOnErr(() => getAgentDm(channelId(), signal)),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  }));
}
