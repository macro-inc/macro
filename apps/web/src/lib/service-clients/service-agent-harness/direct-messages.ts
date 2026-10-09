import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';

import type {
  AgentDmConversationDto,
  AgentDmTurnDto,
} from './generated/schemas';

export type AgentDmConversationResponse = AgentDmConversationDto;
export type AgentDmTurn = AgentDmTurnDto;

export function getAgentDm(channelId: string, signal?: AbortSignal) {
  return fetchWithToken<AgentDmConversationResponse>(
    `${SERVER_HOSTS['agent-harness']}/agent-dms/${channelId}`,
    { method: 'GET', signal }
  );
}

export function retryAgentDm(channelId: string, turn: AgentDmTurn) {
  return fetchWithToken<Record<string, never>>(
    `${SERVER_HOSTS['agent-harness']}/agent-dms/${channelId}/turns/${turn.sourceMessageId}/retry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: turn.actionId }),
    }
  ).then((result) => result.map(() => undefined));
}
