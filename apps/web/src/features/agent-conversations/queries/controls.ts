import { throwOnErr } from '@core/util/result';
import {
  type AgentConversation,
  type AgentConversationTurn,
  retryAgentConversationTurn,
} from '@service-agent-harness/agent-conversations';
import { useMutation } from '@tanstack/solid-query';

type ConversationControl = {
  type: 'retry';
  conversation: Pick<AgentConversation, 'channelId' | 'botId'>;
  turn: AgentConversationTurn;
};

export function useAgentConversationControl(callbacks: {
  onSuccess: () => void;
  onError: () => void;
}) {
  return useMutation(() => ({
    mutationFn: async (action: ConversationControl) => {
      await throwOnErr(() =>
        retryAgentConversationTurn(action.conversation, action.turn)
      );
    },
    ...callbacks,
  }));
}
