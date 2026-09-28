/**
 * "Send the next queued message now": stop the running turn, and show the
 * queue head as sent under the id the server already holds it by. The
 * server dispatches the head when the turn actually ends, and that row
 * promotes the speculation in place.
 */

import type { IssueResult } from '@core/agent-session/AgentSession';
import type { TurnState } from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  QueuedActionDto,
} from '@service-agent-harness/generated/schemas';

export function createSendNext(session: {
  /**
   * The session's turn as it stands at call time, including what it has
   * just speculated: the fold's reactive report lags by the worker round
   * trip, and two presses inside it must not both pass.
   */
  currentTurn: () => TurnState;
  /** The queue as the composer shows it: the server's entries minus any the fold already shows. */
  entries: () => QueuedActionDto[];
  issue: (action: AgentAction) => Promise<IssueResult> | undefined;
  expect: (actionId: string, action: AgentAction) => void;
  retract: (actionId: string) => void;
}): () => void {
  return () => {
    // The head a previous send-next showed as sent is still on its way: the
    // server has not dispatched it, so a stop posted now lands on the turn
    // that is already ending and the server dispatches *that* head when it
    // does - not this one. Speculating this one anyway would show it as sent
    // while it waits in the queue, behind a turn the server is only now
    // starting. The next press is admitted once the log confirms the head.
    if (session.currentTurn() === 'starting') return;
    const head = session.entries()[0];
    if (!head) return;
    const action: AgentAction | undefined =
      head.kind === 'prompt' && head.prompt != null
        ? { type: 'prompt', prompt: head.prompt }
        : head.kind === 'compact'
          ? { type: 'compact' }
          : undefined;
    void session.issue({ type: 'stop' })?.then((result) => {
      if (result.isErr()) session.retract(head.actionId);
    });
    if (action) session.expect(head.actionId, action);
  };
}
