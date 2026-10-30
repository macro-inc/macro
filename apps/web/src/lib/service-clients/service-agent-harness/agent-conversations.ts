import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';

import type {
  AgentConversationDto,
  AgentConversationsDto,
  AgentConversationTurnDto,
} from './generated/schemas';

export type AgentConversation = AgentConversationDto;
export type AgentConversationTurn = AgentConversationTurnDto;

/** The agent conversations in a channel that the caller may see. */
export async function listAgentConversations(
  channelId: string,
  signal?: AbortSignal
) {
  const result = await fetchWithToken<AgentConversationsDto>(
    `${SERVER_HOSTS['agent-harness']}/agent-conversations/${channelId}`,
    { method: 'GET', signal }
  );
  return result.map((data) => data.conversations);
}

export async function retryAgentConversationTurn(
  conversation: Pick<AgentConversation, 'channelId' | 'botId'>,
  turn: AgentConversationTurn
) {
  const result = await fetchWithToken<Record<string, never>>(
    `${SERVER_HOSTS['agent-harness']}/agent-conversations/${conversation.channelId}/${conversation.botId}/turns/${turn.sourceMessageId}/retry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: turn.actionId }),
    }
  );
  return result.map(() => undefined);
}
