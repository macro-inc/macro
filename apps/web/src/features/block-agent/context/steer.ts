/**
 * Force-sending queued messages: Steer on a row, and Send next for the
 * oldest one. Each press shows its message as sent at once and asks the
 * server to run it next - the server moves that entry to the front and
 * cancels the turn in flight. The dispatched row arrives under the same id
 * and promotes the speculation in place.
 *
 * Presses never wait on each other in the UI, but their steers go out one
 * at a time, in press order: the next is sent only once the previous entry
 * has left the server queue. Sent sooner, it would jump in front of the one
 * still waiting and the transcript would run in the reverse order.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import type {
  AgentAction,
  QueuedActionDto,
} from '@service-agent-harness/generated/schemas';
import { type Accessor, createEffect, createSignal } from 'solid-js';

/** The action a queued entry will run as, when the composer can show it sent. */
export function actionForQueuedEntry(
  entry: QueuedActionDto
): AgentAction | undefined {
  if (entry.kind === 'prompt' && entry.prompt != null) {
    return { type: 'prompt', prompt: entry.prompt };
  }
  if (entry.kind === 'compact') return { type: 'compact' };
  return undefined;
}

export type Steering = {
  /** Force-send this queued entry. */
  steer: (actionId: string) => void;
  /** Force-send the oldest entry the composer still shows as queued. */
  sendNext: () => void;
  /** Entries whose last force-send the server refused; they stay queued. */
  failed: Accessor<ReadonlySet<string>>;
};

export function createSteering(session: {
  /**
   * The queue as the composer shows it. A force-sent entry is speculated,
   * so it drops out of here at once and cannot be force-sent twice.
   */
  entries: () => QueuedActionDto[];
  /** Whether the server queue still holds this entry. Reactive. */
  waiting: (actionId: string) => boolean;
  /** Move `actionId` to the front and cancel the turn in flight. */
  steer: (actionId: string) => Promise<boolean>;
  expect: (actionId: string, action: AgentAction) => void;
  retract: (actionId: string) => void;
}): Steering {
  // Pressed, shown as sent, and not steered yet, in press order.
  const [backlog, setBacklog] = createSignal<string[]>([]);
  // The last entry steered, until it leaves the server queue.
  const [ahead, setAhead] = createSignal<string>();
  const [failed, setFailed] = createSignal<ReadonlySet<string>>(new Set());

  const markFailed = (actionId: string, isFailed: boolean) =>
    setFailed((current) => {
      if (current.has(actionId) === isFailed) return current;
      const next = new Set(current);
      if (isFailed) next.add(actionId);
      else next.delete(actionId);
      return next;
    });

  const send = async (actionId: string) => {
    const accepted = await session.steer(actionId);
    if (accepted) return;
    setAhead((current) => (current === actionId ? undefined : current));
    session.retract(actionId);
    // Refused for an entry the server no longer holds means it dispatched
    // or was removed meanwhile; only one still waiting failed.
    if (session.waiting(actionId)) markFailed(actionId, true);
  };

  createEffect(() => {
    const actionId = ahead();
    if (actionId !== undefined && !session.waiting(actionId)) {
      setAhead(undefined);
    }
  });

  createEffect(() => {
    if (ahead() !== undefined) return;
    const [next, ...rest] = backlog();
    if (next === undefined) return;
    setBacklog(rest);
    setAhead(next);
    fireAndForget(send(next), 'agent-queue');
  });

  const steer = (actionId: string) => {
    const entry = session.entries().find((item) => item.actionId === actionId);
    const action = entry ? actionForQueuedEntry(entry) : undefined;
    if (!action) return;
    markFailed(actionId, false);
    session.expect(actionId, action);
    setBacklog((current) => [...current, actionId]);
  };

  return {
    steer,
    sendNext: () => {
      const head = session.entries()[0];
      if (head) steer(head.actionId);
    },
    failed,
  };
}
