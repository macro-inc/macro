/**
 * The live one-line status the server words from a running session's tool
 * calls ("Searching your workspace…"), for every surface showing the session.
 *
 * Ephemeral, like the event that carries it: nothing fetches it, so a surface
 * that mounts mid-turn shows its own label until the next line arrives. The
 * server clears it when the turn ends; a settled turn clears it here too, so
 * a lost clear never carries a line into the next turn.
 */

import type { Accessor } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  isWorkingTurn,
  sessionTurn,
  subscribeSessionTurns,
} from './session-turn';

const [lines, setLines] = createStore<Record<string, string | undefined>>({});

subscribeSessionTurns((sessionId) => {
  if (!isWorkingTurn(sessionTurn(sessionId))) setLines(sessionId, undefined);
});

/** Record a session's newest line, or clear it with `null`. */
export function publishSessionActivity(
  sessionId: string,
  text: string | null
): void {
  setLines(sessionId, text ?? undefined);
}

/** The session's current line while it is working, followed reactively. */
export function useSessionActivity(
  sessionId: Accessor<string | undefined>
): Accessor<string | undefined> {
  return () => {
    const id = sessionId();
    return id === undefined ? undefined : lines[id];
  };
}
