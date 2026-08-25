import type { AgentSessionRenamedEvent } from './realtime-protocol';

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
