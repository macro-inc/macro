/**
 * The wire contract for streaming a live agent session's log.
 *
 * Hand-written against `crates/agent_session/src/outbound/
 * connection_gateway_realtime.rs`, whose module docs are the agreement.
 * Websocket payloads are outside the OpenAPI surface, so nothing generates
 * this; the two files point at each other and must be changed together.
 *
 * The shape is deliberate rather than incidental: past the two ids, an event
 * *is* an {@link AgentSessionLogEntryDto} — the same entry
 * `GET /agent-sessions/channel/{id}/log` serves. A client catching up on a log
 * and a client following one are folding the same bytes, so both go through
 * one fold and cannot disagree about what a frame means.
 */

import type { AgentSessionLogEntryDto } from '@service-storage/generated/schemas/agentSessionLogEntryDto';

/**
 * The realtime message type carrying one appended log frame.
 *
 * Must equal `AGENT_SESSION_LOG` on the Rust side. An unrecognized type is
 * ignored rather than rejected, so a mismatch here breaks streaming silently.
 */
export const AGENT_SESSION_LOG_EVENT = 'agent_session_log';

/**
 * One frame appended to a live session's log.
 *
 * `channelId` addresses it — a viewer opened a channel and may not know a
 * session exists. `agentSessionId` is what the fold keys its messages on, so
 * it must be passed through unchanged: it is half of the
 * `"{agentSessionId}:{turn}:{author}"` that joins a folded message to the
 * placeholder row rendering it.
 */
export type AgentSessionLogEvent = {
  channelId: string;
  agentSessionId: string;
} & AgentSessionLogEntryDto;

/**
 * The frame on its own, in the shape the fold takes.
 *
 * Structural, not a copy: the event carries the entry's fields inline, so
 * dropping the two ids leaves exactly what {@link foldSession} and the
 * incremental machine already accept.
 */
export function entryOf(event: AgentSessionLogEvent): AgentSessionLogEntryDto {
  const {
    channelId: _channelId,
    agentSessionId: _agentSessionId,
    ...entry
  } = event;
  return entry;
}
