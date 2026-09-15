/** The Connection Gateway event type for one appended agent-session frame. */
export const AGENT_SESSION_LOG_EVENT = 'agent_session_log';

/** The Connection Gateway event type for a persisted session-name change. */
export const AGENT_SESSION_RENAMED_EVENT = 'agent_session_renamed';

/**
 * The Connection Gateway event type carrying a session's whole action queue
 * after any change (enqueue, edit, remove, dispatch, turn-end drain).
 */
export const AGENT_SESSION_QUEUE_EVENT = 'agent_session_queue';

import type {
  AgentSessionLogEntryDto,
  QueuedActionDto,
} from '@service-agent-harness/generated/schemas';

/**
 * One persisted log entry, addressed by session for realtime delivery.
 *
 * This mirrors `AgentSessionLogEvent` in
 * `crates/agent_session/src/outbound/connection_gateway_realtime.rs`.
 */
export type AgentSessionLogEvent = {
  agentSessionId: string;
} & AgentSessionLogEntryDto;

/** Mirrors `AgentSessionRenamedEvent` in the backend realtime adapter. */
export type AgentSessionRenamedEvent = {
  agentSessionId: string;
  name: string;
};

/**
 * A session's action queue after a change. Mirrors `AgentSessionQueueEvent`
 * in `crates/agent_session/src/outbound/connection_gateway_realtime.rs`.
 *
 * Always the full queue, never a delta — `entries` are the exact rows
 * `GET /agent-sessions/{id}/queue` serves, oldest (next to dispatch) first —
 * so any one event is a complete, self-sufficient truth and the last one to
 * arrive wins unconditionally.
 */
export type AgentSessionQueueEvent = {
  agentSessionId: string;
  entries: QueuedActionDto[];
};

/** Remove the realtime address, leaving the exact persisted entry shape. */
export function entryOf(event: AgentSessionLogEvent): AgentSessionLogEntryDto {
  const { agentSessionId: _agentSessionId, ...entry } = event;
  return entry;
}

/** A persisted session changed; consumers reload its current metadata. */
export const AGENT_SESSION_UPDATED_EVENT = 'agent_session_updated';
export type AgentSessionUpdatedEvent = { agentSessionId: string };

/**
 * A session's captured changes moved: a capture started, landed, or failed.
 * Carries only the session id; consumers refetch the changes summary.
 * Mirrors `AGENT_SESSION_CHANGES` in
 * `crates/agent_session/src/outbound/connection_gateway_realtime.rs`.
 */
export const AGENT_SESSION_CHANGES_EVENT = 'agent_session_changes';
export type AgentSessionChangesEvent = { agentSessionId: string };
