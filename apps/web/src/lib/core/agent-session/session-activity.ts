/**
 * The live one-line status the server words from a running session's tool
 * calls ("Searching your workspace…"), for every surface showing the session.
 *
 * Ephemeral, like the event that carries it: nothing fetches it, so a surface
 * that mounts mid-turn shows its own label until the next line arrives, and
 * the server clears it when the turn ends.
 */

import { type Accessor, createSignal, onCleanup } from 'solid-js';

type Listener = (sessionId: string) => void;

const listeners = new Set<Listener>();
const summaries = new Map<string, string>();

/** Record a session's newest line, or clear it with `null`. */
export function publishSessionActivity(
  sessionId: string,
  text: string | null
): void {
  if ((summaries.get(sessionId) ?? null) === text) return;
  if (text === null) summaries.delete(sessionId);
  else summaries.set(sessionId, text);
  for (const listener of listeners) listener(sessionId);
}

/** The session's current line while it is working, followed reactively. */
export function useSessionActivity(
  sessionId: Accessor<string | undefined>
): Accessor<string | undefined> {
  const [epoch, setEpoch] = createSignal(0);
  const listener: Listener = (changed) => {
    if (changed === sessionId()) setEpoch((current) => current + 1);
  };
  listeners.add(listener);
  onCleanup(() => listeners.delete(listener));

  return () => {
    epoch();
    const id = sessionId();
    return id === undefined ? undefined : summaries.get(id);
  };
}

/** Drop published lines between tests. */
export function resetSessionActivity(): void {
  summaries.clear();
  listeners.clear();
}
