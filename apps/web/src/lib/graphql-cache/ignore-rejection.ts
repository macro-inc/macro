/**
 * Waits for `work` and drops its rejection. Use it only where the failure is
 * already handled on another path (a transport's `onError`, a registration's
 * reject), so the promise itself needs no handler.
 */
export async function ignoreRejection(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // Handled on the work's own failure path.
  }
}
