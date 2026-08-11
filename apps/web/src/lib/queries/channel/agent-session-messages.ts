/**
 * Following a live agent session's folded messages.
 *
 * The server folds the session's protocol log and pushes the one message each
 * frame changed over the websocket as an `agent_session_message` event (see
 * `crates/agent_session/src/outbound/connection_gateway_realtime.rs`, whose
 * module docs are the wire contract). An event carries the whole message, so
 * applying one is a replace keyed by `agentSessionMessageId` — there is no
 * client-side fold, no machine, and no state beyond who is listening.
 *
 * # Aligning a snapshot with the stream
 *
 * A channel that opens mid-session fetches the folded messages so far and
 * follows what comes after, and the two overlap: events keep arriving while
 * the fetch is in flight, and an event can describe a frame the snapshot
 * already folded. The server settles this with a counter instead of content
 * comparison — the snapshot says how many log frames it folded (`logLength`)
 * and every event says which frame produced it (`logIndex`) — so the rule is
 * one line: drop events with `logIndex <= logLength`, apply the rest. The
 * consumer (`folded-messages.ts`) buffers events from before its fetch
 * resolves and filters them by that rule.
 */

import type { FoldedMessageDto } from '@service-storage/generated/schemas/foldedMessageDto';

/** The body of an `agent_session_message` websocket event. */
export type AgentSessionMessageEvent = {
  /** The channel whose viewers should see this. */
  channelId: string;
  /** The session the message was folded from. */
  agentSessionId: string;
  /** `new` the first time a message is reported, `update` after. */
  kind: 'new' | 'update';
  /** How many log frames the fold had consumed when it produced this. */
  logIndex: number;
  /** The message as it now stands — the REST endpoint's own shape. */
  message: FoldedMessageDto;
};

/** A channel view that wants the messages a live session changes. */
export type AgentSessionMessageListener = (
  event: AgentSessionMessageEvent
) => void;

const listeners = new Map<string, Set<AgentSessionMessageListener>>();

/**
 * Start receiving a channel's folded-message events. Returns a function that
 * stops.
 *
 * Call this before issuing the snapshot fetch, not after: an event that
 * arrives in between may or may not be contained in the snapshot, and only a
 * received event can be filtered by its `logIndex`. One that arrives before
 * anyone listens is dropped here — it is already in the log the fetch reads.
 */
export function followAgentSessionMessages(
  channelId: string,
  listener: AgentSessionMessageListener
): () => void {
  const set = listeners.get(channelId) ?? new Set();
  set.add(listener);
  listeners.set(channelId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(channelId);
  };
}

/**
 * Route one websocket event to whoever has its channel open.
 *
 * An event for a channel nobody is watching is dropped: it is already in the
 * log the next reader fetches.
 */
export function handleAgentSessionMessage(
  event: AgentSessionMessageEvent
): void {
  const set = listeners.get(event.channelId);
  if (!set) return;
  for (const listener of set) listener(event);
}
