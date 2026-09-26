export type RenderInvalidation = 'reset' | 'session-ended';
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
