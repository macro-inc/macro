/**
 * Coalesce a burst, then repeat if another invalidation arrives during the read.
 * `join` shares a read already in flight instead of queueing another behind it,
 * for a poll that needs a recent read rather than one that starts after a change.
 */
export function createTrailingRefetch(
  enabled: () => boolean,
  refetch: () => Promise<unknown>
) {
  let pending: Promise<void> | undefined;
  let requested = false;
  const refresh = () => {
    if (!enabled()) return Promise.resolve();
    requested = true;
    pending ??= Promise.resolve().then(async () => {
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
    });
    return pending;
  };
  return Object.assign(refresh, { join: () => pending ?? refresh() });
}
