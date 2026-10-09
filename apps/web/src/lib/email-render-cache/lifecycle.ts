/**
 * - `reset`: this tab learned something other tabs may not have; clear storage
 *   and tell them.
 * - `local`: every tab observes the event itself (sync events, cache resets);
 *   clear storage without rebroadcasting, which would multiply the churn.
 * - `session-ended`: an explicit sign-out; other tabs stop caching for it.
 */
export type RenderInvalidation = 'reset' | 'local' | 'session-ended';
type InvalidationListener = (reason: RenderInvalidation) => Promise<void>;
const listeners = new Set<InvalidationListener>();

/** App-session registrations, mirroring normalized-cache lifecycle ownership. */
export function registerEmailRenderInvalidation(
  listener: InvalidationListener
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cancels consumers synchronously; durable clears continue before completion. */
export async function invalidateEmailRenders(
  reason: RenderInvalidation = 'reset'
): Promise<void> {
  await Promise.allSettled([...listeners].map((listener) => listener(reason)));
}
