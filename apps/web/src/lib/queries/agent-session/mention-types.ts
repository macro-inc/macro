export type AgentSessionStatus =
  | { kind: 'no_messages' }
  | { kind: 'disconnected' }
  | { kind: 'event'; event: string };

export type AgentSessionMentionData = {
  id: string;
  name: string;
  ownerId: string;
  botId: string;
  bot?: { id: string; name: string; avatarUrl?: string | null } | null;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
};

export type AgentSessionMentionPreview =
  | { access: 'access'; data: AgentSessionMentionData }
  | { access: 'no_access' | 'does_not_exist' };

export function normalizeAgentSessionStatus(
  status: string
): AgentSessionStatus {
  if (status === 'no_messages' || status === 'disconnected')
    return { kind: status };
  return { kind: 'event', event: status };
}
