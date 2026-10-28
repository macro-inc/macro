export type AgentMessageTarget = {
  messageTurn: number;
  author: 'user' | 'agent';
};

export const AGENT_SEARCH_PARAMS = {
  messageTurn: 'agent_message_turn',
  author: 'agent_message_author',
} as const;

export function agentMessageParams(
  target: AgentMessageTarget
): Record<string, string> {
  return {
    [AGENT_SEARCH_PARAMS.messageTurn]: String(target.messageTurn),
    [AGENT_SEARCH_PARAMS.author]: target.author,
  };
}

export function parseAgentMessageTarget(
  params: Record<string, unknown>
): AgentMessageTarget | undefined {
  const turn = params[AGENT_SEARCH_PARAMS.messageTurn];
  const author = params[AGENT_SEARCH_PARAMS.author];
  if (typeof turn !== 'string' || !/^\d+$/.test(turn)) return;
  const messageTurn = Number(turn);
  if (!Number.isSafeInteger(messageTurn)) return;
  if (author !== 'user' && author !== 'agent') return;
  return { messageTurn, author };
}
