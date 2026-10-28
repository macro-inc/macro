/**
 * Last-known fold turn for each session, plus a short-lived "frames are
 * arriving" mark for sessions nobody has open yet.
 *
 * The fold's `turn` is the one answer to "is the agent working". Open
 * sessions publish it as they fold. Unopened sessions only appear here once
 * a live log frame lands — list rows then follow that session until the
 * turn settles.
 */

import type { TurnState } from '@service-agent-fold/generated/types';

/** How long a stray log frame keeps a list row interested in following. */
export const SESSION_ACTIVITY_WINDOW_MS = 120_000;

type Listener = (sessionId: string) => void;

const listeners = new Set<Listener>();
const turns = new Map<string, TurnState>();
const activityUntil = new Map<string, number>();

/** A turn the list should treat as still in motion. */
export function isWorkingTurn(turn: TurnState | null | undefined): boolean {
  return turn === 'starting' || turn === 'running' || turn === 'stopping';
}

/** The last published turn for `sessionId`, if any. */
export function sessionTurn(sessionId: string): TurnState | undefined {
  return turns.get(sessionId);
}

/** Record the fold's turn so list rows can follow without opening the block. */
export function publishSessionTurn(sessionId: string, turn: TurnState): void {
  if (turns.get(sessionId) === turn) return;
  turns.set(sessionId, turn);
  notify(sessionId);
}

/**
 * A live log frame arrived for a session nobody has acquired. List rows
 * treat this as a reason to follow until the fold names a settled turn.
 */
export function noteSessionActivity(sessionId: string): void {
  activityUntil.set(sessionId, Date.now() + SESSION_ACTIVITY_WINDOW_MS);
  notify(sessionId);
}

/** Whether a recent log frame said this session is moving. */
export function hasSessionActivity(sessionId: string): boolean {
  const until = activityUntil.get(sessionId);
  return until !== undefined && until > Date.now();
}

/** Follow turn and activity changes. */
export function subscribeSessionTurns(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(sessionId: string): void {
  for (const listener of listeners) listener(sessionId);
}

/** Drop published state between tests. */
export function resetSessionTurns(): void {
  turns.clear();
  activityUntil.clear();
  listeners.clear();
}
