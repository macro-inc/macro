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

const updateListeners = new Map<string, Set<() => void>>();

/** Refetch current state rather than applying potentially out-of-order deltas. */
export function handleAgentSessionUpdated(
  event: AgentSessionUpdatedEvent
): void {
  for (const listener of updateListeners.get(event.agentSessionId) ?? [])
    listener();
}

/** Recover session metadata updates missed while the gateway was disconnected. */
export function invalidateAgentSessionMetadata(): void {
  for (const listeners of updateListeners.values()) {
    for (const listener of listeners) listener();
  }
}

export function subscribeAgentSessionUpdated(
  id: string,
  listener: () => void
): () => void {
  let listeners = updateListeners.get(id);
  if (!listeners) {
    listeners = new Set();
    updateListeners.set(id, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) updateListeners.delete(id);
  };
}
