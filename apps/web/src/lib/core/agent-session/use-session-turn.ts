/**
 * The fold's turn for a list row: last published value, and a follow of the
 * shared session when one is already open or a live frame just arrived.
 */

import type { TurnState } from '@service-agent-fold/generated/types';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import { AgentSession } from './AgentSession';
import {
  hasSessionActivity,
  isWorkingTurn,
  sessionTurn,
  subscribeSessionTurns,
} from './session-turn';

function shouldFollow(sessionId: string): boolean {
  return (
    AgentSession.get(sessionId) !== undefined ||
    hasSessionActivity(sessionId) ||
    isWorkingTurn(sessionTurn(sessionId))
  );
}

/** Latest fold turn for `sessionId`, followed while the row is mounted. */
export function useSessionTurn(
  sessionId: Accessor<string>
): Accessor<TurnState | undefined> {
  const [epoch, setEpoch] = createSignal(0);
  onCleanup(subscribeSessionTurns(() => setEpoch((current) => current + 1)));

  const follow = createMemo(() => {
    epoch();
    return shouldFollow(sessionId());
  });

  createMemo(() => {
    const id = sessionId();
    if (!follow()) return;
    const session = AgentSession.acquire(id);
    // A row follows a session to show its turn and renders nothing from the
    // load, so a load it abandons by unmounting is not this caller's problem.
    // Left floating it surfaced as an unhandled rejection on every scroll.
    void session.load().catch(() => undefined);
    onCleanup(() => session.release());
  });

  return () => {
    epoch();
    return sessionTurn(sessionId());
  };
}
