/**
 * "Steer" a queued message: show it as sent now, and ask the server to run
 * it next. The server moves that entry to the front and cancels the turn in
 * flight, so it flushes ahead of anything queued before it. The dispatched
 * row arrives under the same id and promotes this speculation in place.
 */

import type { TurnState } from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  QueuedActionDto,
} from '@service-agent-harness/generated/schemas';
import { actionForQueuedEntry } from './send-next';

export function createSteer(session: {
  /**
   * The session's turn as it stands at call time. A steer that already
   * showed its prompt as sent reads `starting` here, and a second press
   * inside that window must not jump another entry in front of it.
   */
  currentTurn: () => TurnState;
  /** The queue as the composer shows it. */
  entries: () => QueuedActionDto[];
  /** Move `actionId` to the front and cancel the turn in flight. */
  steer: (actionId: string) => Promise<boolean>;
  expect: (actionId: string, action: AgentAction) => void;
  retract: (actionId: string) => void;
}): (actionId: string) => void {
  return (actionId) => {
    if (session.currentTurn() === 'starting') return;
    const entry = session.entries().find((item) => item.actionId === actionId);
    const action = entry ? actionForQueuedEntry(entry) : undefined;
    if (!action) return;
    session.expect(actionId, action);
    void (async () => {
      const accepted = await session.steer(actionId);
      if (!accepted) session.retract(actionId);
    })();
  };
}
