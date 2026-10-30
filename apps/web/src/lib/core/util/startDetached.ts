async function settle(
  work: unknown,
  onRejected: (error: unknown) => void
): Promise<void> {
  try {
    await work;
  } catch (error: unknown) {
    onRejected(error);
  }
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
