/** Coalesce a burst, then repeat if another invalidation arrives during the read. */
export function createTrailingRefetch(
  enabled: () => boolean,
  refetch: () => Promise<unknown>
) {
  let pending: Promise<void> | undefined;
  let requested = false;

  async function drain() {
    // Let invalidations in the same turn coalesce, and assign pending before
    // refetch can synchronously trigger another invalidation.
    await Promise.resolve();
    try {
      let failed = false;
      let error: unknown;
      while (requested && enabled()) {
        requested = false;
        try {
          await refetch();
          failed = false;
        } catch (cause) {
          failed = true;
          error = cause;
        }
      }
      if (failed) throw error;
    } finally {
      pending = undefined;
    }
  }

  return () => {
    if (!enabled()) return Promise.resolve();
    requested = true;
    pending ??= drain();
    return pending;
  };
}
