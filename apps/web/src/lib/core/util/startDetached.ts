async function settle(
  work: unknown,
  onRejected: (error: unknown) => void
): Promise<void> {
  // allSettled subscribes to work synchronously; awaiting work itself would
  // subscribe to a zone.js promise a microtask late, after zone.js may already
  // have reported its rejection as unhandled.
  const [result] = await Promise.allSettled([work]);
  if (result.status === 'rejected') onRejected(result.reason);
}

/**
 * Starts `work` without waiting for it and passes a rejection to `onRejected`.
 * It imports nothing, so worker bundles can use it with their own reporter;
 * elsewhere use `fireAndForget`, which reports to Telemetry.
 */
export function startDetached(
  work: unknown,
  onRejected: (error: unknown) => void
): void {
  // settle never rejects; .oxlintrc.json lists it as a known-safe call.
  settle(work, onRejected);
}
