import { Telemetry, type TraceContext } from '@macro-inc/observability';
import { createSignal } from 'solid-js';
import { z } from 'zod';

// A work hint, not a directory or query-history cache. A running scan finishes
// before the next coalesced refresh; events never rewind its cursor.
export const [contactRefreshRevision, requestContactRefresh] = (() => {
  const [revision, setRevision] = createSignal(0);
  return [revision, () => setRevision((value) => value + 1)] as const;
})();

/** Contacts the server named as changed, with the trace that changed them. */
export type ContactTopUpListener = (
  ids: readonly string[],
  context: TraceContext
) => void;

// The server names at most one lookup batch; the top-up rejects anything larger.
const CONTACTS_INVALIDATION = z.object({
  changed: z.array(z.string()).optional(),
});

// Only the leader tab's contact sync listens; other tabs drop named contacts
// instead of holding them, since the leader receives the same invalidation.
const topUpListeners = new Set<ContactTopUpListener>();

export function subscribeContactTopUp(
  listener: ContactTopUpListener
): () => void {
  topUpListeners.add(listener);
  return () => {
    topUpListeners.delete(listener);
  };
}

/** A `contacts_invalidation` frame always schedules the coalesced refresh. When
 * it names the changed contacts, the leader also re-reads them right away. */
export function handleContactsInvalidation(
  payload: unknown,
  trace: Record<string, string> | undefined
): void {
  requestContactRefresh();
  const parsed = CONTACTS_INVALIDATION.safeParse(payload);
  const changed = parsed.success ? parsed.data.changed : undefined;
  if (!changed?.length || !topUpListeners.size) return;

  const traceparent = trace?.traceparent;
  const context = traceparent
    ? Telemetry.remoteContext(traceparent)
    : Telemetry.captureContext();
  for (const listener of topUpListeners) listener(changed, context);
}
