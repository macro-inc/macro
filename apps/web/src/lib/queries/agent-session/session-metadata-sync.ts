import { queryClient } from '@queries/client';
import { agentSessionKeys } from './keys';
import type {
  AgentSessionRenamedEvent,
  AgentSessionUpdatedEvent,
} from './realtime-protocol';

const renameListeners = new Set<(event: AgentSessionRenamedEvent) => void>();

/** Apply a server-persisted rename to active agent-session consumers. */
export function handleAgentSessionRenamed(
  event: AgentSessionRenamedEvent
): void {
  for (const listener of renameListeners) listener(event);
}

/** Follow name changes while a session-scoped view is mounted. */
export function subscribeAgentSessionRenamed(
  listener: (event: AgentSessionRenamedEvent) => void
): () => void {
  renameListeners.add(listener);
  return () => renameListeners.delete(listener);
}

/** Cancel stale snapshots before refetching the committed session metadata. */
export async function handleAgentSessionUpdated(
  event: AgentSessionUpdatedEvent
): Promise<void> {
  const filters = {
    queryKey: agentSessionKeys.detail(event.agentSessionId).queryKey,
    exact: true,
  };
  await queryClient.cancelQueries(filters);
  await queryClient.invalidateQueries(filters);
}

/** Recover session metadata updates missed while the gateway was disconnected. */
export async function invalidateAgentSessionMetadata(): Promise<void> {
  const filters = { queryKey: agentSessionKeys.detail._def };
  await queryClient.cancelQueries(filters);
  await queryClient.invalidateQueries(filters);
}
