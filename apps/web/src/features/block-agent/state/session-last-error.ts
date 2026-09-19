/**
 * The last failed turn a live session reported, keyed by session id.
 *
 * The fold already knows this — it is the newest agent message's `stop` —
 * but the Agents sidebar and Home rows do not hold a transcript. The open
 * session writes here as its messages change, so those rows can show that
 * the session errored without loading every log.
 */

import { type Accessor, createSignal, onCleanup } from 'solid-js';

const errors = new Map<string, string>();
const listeners = new Set<(id: string) => void>();

/** Record or clear the newest failure for an open session. */
export function setSessionLastError(
  id: string,
  message: string | undefined
): void {
  const current = errors.get(id);
  if (message === current) return;
  if (message === undefined) errors.delete(id);
  else errors.set(id, message);
  for (const listener of listeners) listener(id);
}

/** The newest failure written for `id`, if any. */
export function sessionLastError(id: string): string | undefined {
  return errors.get(id);
}

/** Follow the newest failure for `id` from the session that is writing it. */
export function useSessionLastError(
  id: Accessor<string>
): Accessor<string | undefined> {
  const [error, setError] = createSignal(errors.get(id()));
  const sync = (changed: string) => {
    if (changed === id()) setError(() => errors.get(changed));
  };
  listeners.add(sync);
  onCleanup(() => listeners.delete(sync));
  return error;
}
