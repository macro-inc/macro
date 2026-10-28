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
export function listAgentConversations(
  channelId: string,
  signal?: AbortSignal
) {
  return fetchWithToken<AgentConversationsDto>(
    `${SERVER_HOSTS['agent-harness']}/agent-conversations/${channelId}`,
    { method: 'GET', signal }
  ).then((result) => result.map((data) => data.conversations));
}

export function retryAgentConversationTurn(
  conversation: Pick<AgentConversation, 'channelId' | 'botId'>,
  turn: AgentConversationTurn
) {
  return fetchWithToken<Record<string, never>>(
    `${SERVER_HOSTS['agent-harness']}/agent-conversations/${conversation.channelId}/${conversation.botId}/turns/${turn.sourceMessageId}/retry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: turn.actionId }),
    }
  ).then((result) => result.map(() => undefined));
}
