import { throwOnErr } from '@core/util/result';
import {
  type AgentDmTurn,
  retryAgentDm,
} from '@service-agent-harness/direct-messages';
import { useMutation } from '@tanstack/solid-query';

type DmControl = { type: 'retry'; channelId: string; turn: AgentDmTurn };

export function useAgentDmControl(callbacks: {
  onSuccess: () => void;
  onError: () => void;
}) {
  return useMutation(() => ({
    mutationFn: async (action: DmControl) => {
      await throwOnErr(() => retryAgentDm(action.channelId, action.turn));
    },
    ...callbacks,
  }));
}
