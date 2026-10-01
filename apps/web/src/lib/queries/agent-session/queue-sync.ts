/**
 * Fan-out for `agent_session_queue` websocket events, mirroring
 * `session-metadata-sync.ts`: the websocket dispatch calls the handler once
 * per event, and every mounted session view that cares follows through a
 * subscription, filtering by session id itself.
 *
 * Also exposes the socket-session boundary: a queue consumer baselines from
 * `GET .../queue` once per socket session and treats the socket as the only
 * writer after its first event, so it needs to know when a new socket
 * session begins.
 */

import { WebsocketEvent } from '@macro-inc/collaboration/websocket';
import { ws } from '@service-connection/websocket';
import type { AgentSessionQueueEvent } from './realtime-protocol';

const queueListeners = new Set<(event: AgentSessionQueueEvent) => void>();

/** Deliver one queue snapshot to every subscribed session view. */
export function handleAgentSessionQueue(event: AgentSessionQueueEvent): void {
  for (const listener of queueListeners) listener(event);
}

/** Follow queue snapshots while a session-scoped view is mounted. */
export function subscribeAgentSessionQueue(
  listener: (event: AgentSessionQueueEvent) => void
): () => void {
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
}

/**
 * Fires whenever the gateway websocket (re)opens — the start of a new socket
 * session, after which events may have been missed and a fresh baseline is
 * needed.
 */
export function subscribeSocketSessionStarted(
  listener: () => void
): () => void {
  const handler = () => listener();
  ws.addEventListener(WebsocketEvent.Open, handler);
  return () => ws.removeEventListener(WebsocketEvent.Open, handler);
}

/** A change in the gateway socket's connection worth recording against a session. */
export type SocketTransition =
  | 'open'
  | 'close'
  | 'reconnect'
  | 'retry'
  | 'heartbeat_missed';

const TRANSITION_EVENTS: readonly [WebsocketEvent, SocketTransition][] = [
  [WebsocketEvent.Open, 'open'],
  [WebsocketEvent.Close, 'close'],
  [WebsocketEvent.Reconnect, 'reconnect'],
  [WebsocketEvent.retry, 'retry'],
  [WebsocketEvent.HeartbeatMissed, 'heartbeat_missed'],
];

/**
 * Follow the gateway socket's connection state. For telemetry: a session
 * whose rows stopped arriving reads differently when the socket was
 * flapping underneath it than when it stayed open the whole time.
 */
export function subscribeSocketTransitions(
  listener: (transition: SocketTransition) => void
): () => void {
  const handlers = TRANSITION_EVENTS.map(([event, transition]) => {
    const handler = () => listener(transition);
    ws.addEventListener(event, handler);
    return () => ws.removeEventListener(event, handler);
  });
  return () => {
    for (const unsubscribe of handlers) unsubscribe();
  };
}
