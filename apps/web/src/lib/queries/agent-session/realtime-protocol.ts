/** The Connection Gateway event type for one appended agent-session frame. */
export const AGENT_SESSION_LOG_EVENT = 'agent_session_log';

import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';

/**
 * One persisted log entry, addressed by session for realtime delivery.
 *
 * This mirrors `AgentSessionLogEvent` in
 * `crates/agent_session/src/outbound/connection_gateway_realtime.rs`.
 */
export type AgentSessionLogEvent = {
  agentSessionId: string;
} & AgentSessionLogEntryDto;

/** Remove the realtime address, leaving the exact persisted entry shape. */
export function entryOf(event: AgentSessionLogEvent): AgentSessionLogEntryDto {
  const { agentSessionId: _agentSessionId, ...entry } = event;
  return entry;
}
