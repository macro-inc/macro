/**
 * Shared vocabulary for the block-agent UI component library.
 *
 * Components in this directory are pure: props in, JSX out. No contexts, no
 * queries, no block signals. Data shapes come from the agent-fold wire types
 * where one exists; anything else is declared here.
 *
 * Several components are ports of opencode's session-ui/ui packages
 * (github.com/sst/opencode, MIT © 2025 opencode), adapted to Macro's tokens
 * and the agent-fold vocabulary.
 */

import type { ToolStatus } from '@service-agent-fold/generated/types';

export type { FileDiff, ToolStatus } from '@service-agent-fold/generated/types';

/** One entry of an agent's plan / todo list. */
export interface TodoItem {
  /** What the agent said it would do. */
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

/** One question the agent asked the user, with the answer(s) chosen. */
export interface AnsweredQuestion {
  question: string;
  /** Empty when the question went unanswered. */
  answers: string[];
}

/** Whether a tool call is still in flight. */
export function isToolActive(status: ToolStatus): boolean {
  return status === 'pending' || status === 'running';
}

/**
 * A call's status as its row should read it, given whether its turn is
 * still running.
 *
 * A call still `pending` or `running` once the turn is over was cut off —
 * the harness never said how it ended, and never will — so it is not active,
 * whatever the log last recorded. It settles as completed: the call happened
 * and is over, which is all the row claims. A failure it never reported is
 * not one to invent.
 */
export function settledToolStatus(
  status: ToolStatus,
  inFlight: boolean
): ToolStatus {
  return !inFlight && isToolActive(status) ? 'completed' : status;
}
