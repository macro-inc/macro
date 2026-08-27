/**
 * The session's live status: seeded from the GET snapshot, then followed
 * through the same realtime stream the transcript folds.
 *
 * There is no dedicated status feed — status is a projection of the log
 * (`crates/agent_session/src/outbound/postgres/mod.rs`, the log-create
 * transaction), and every appended frame, including the system-event frames
 * that move the status, is published over the one `agent_session_log`
 * gateway event. This controller taps those raw frames and keeps the last
 * system event, exactly as the backend projection does.
 */

import { subscribeAgentSessionLog } from '@queries/agent-session/session-fold';
import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/** Mirrors `SessionStatusDto`, which mirrors the backend's `SessionStatus`. */
export type SessionStatus =
  /** No status updates received. */
  | { kind: 'no_messages' }
  /** The last system event received from the runtime, e.g. `acp_ready`. */
  | { kind: 'event'; event: string }
  /** The session disconnected without sending a closed event. */
  | { kind: 'disconnected' };

/**
 * The status a log frame projects, or undefined for frames that carry none
 * (ACP traffic). The backend's projection rule, applied client-side to the
 * same bytes.
 */
export function statusFromEntry(
  entry: AgentSessionLogEntryDto
): SessionStatus | undefined {
  const content = entry.content as { type?: string; event?: string };
  if (content?.type !== 'event') return undefined;
  if (typeof content.event !== 'string') return undefined;
  return { kind: 'event', event: content.event };
}

export type SessionStatusController = {
  status: Accessor<SessionStatus>;
};

/**
 * Whether the runtime is gone, in either shape the status can take.
 *
 * The GET snapshot reports it as its own kind; a live frame always arrives
 * as `{ kind: 'event', event: 'disconnected' }`, because the projection
 * keeps the wire name. Reading only the former is how a live disconnect gets
 * missed — which left `working` latched on and the composer waiting on a
 * runtime that had gone away.
 */
export function isDisconnected(status: SessionStatus): boolean {
  return (
    status.kind === 'disconnected' ||
    (status.kind === 'event' && status.event === 'disconnected')
  );
}

/**
 * `sessionId` is absent until a just-created session's `POST` lands
 * (`pending-session.ts`). There is no log to follow before then, so the
 * controller holds its initial `no_messages` — which the pill reads as
 * "Starting" — and subscribes once there is something to subscribe to.
 */
export function createSessionStatusController(options: {
  sessionId: Accessor<string | undefined>;
  /** The GET snapshot's status, absent until the session loads. */
  seed: Accessor<SessionStatus | undefined>;
}): SessionStatusController {
  const [status, setStatus] = createSignal<SessionStatus>({
    kind: 'no_messages',
  });

  // A live frame is always newer than the snapshot; once one lands, the
  // (possibly slower) GET must not roll the status back.
  let live = false;

  createEffect(() => {
    const seeded = options.seed();
    if (seeded && !live) setStatus(seeded);
  });

  createEffect(() => {
    const id = options.sessionId();
    if (!id) return;
    live = false;
    const unsubscribe = subscribeAgentSessionLog(id, (event) => {
      const next = statusFromEntry(event);
      if (!next) return;
      live = true;
      setStatus(next);
    });
    onCleanup(unsubscribe);
  });

  return { status };
}
