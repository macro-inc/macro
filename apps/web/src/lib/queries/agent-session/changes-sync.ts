import { queryClient } from '@queries/client';
import { agentSessionChangesKeys } from './keys';
import type { AgentSessionChangesEvent } from './realtime-protocol';

/**
 * A session's changes moved on the server. The event carries no body, so
 * the summary refetches; the patch query is keyed by changeset id and a new
 * capture simply reads a new key.
 */
export async function handleAgentSessionChanges(
  event: AgentSessionChangesEvent
): Promise<void> {
  await invalidateAgentSessionChanges(event.agentSessionId);
}

/** Drop and refetch one session's changes summary. */
export async function invalidateAgentSessionChanges(
  sessionId: string
): Promise<void> {
  const filters = {
    queryKey: agentSessionChangesKeys.summary(sessionId).queryKey,
    exact: true,
  };
  await queryClient.cancelQueries(filters);
  await queryClient.invalidateQueries(filters);
}
