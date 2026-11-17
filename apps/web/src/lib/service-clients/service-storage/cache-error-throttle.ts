const REPORT_INTERVAL_MS = 60_000;
const MAX_TRACKED_ERRORS = 100;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Admits one report per minute for each kind of cache failure. Failures that
 * differ only by a number, such as an owner epoch, count as one kind. The next
 * admitted report carries how many were dropped since the last one.
 */
export function createCacheErrorThrottle(now: () => number = Date.now) {
  const seen = new Map<string, { reportedAt: number; suppressed: number }>();
  return {
    admit(
      error: unknown,
      operationKind?: string
    ): { report: boolean; suppressed: number } {
      const key = `${operationKind ?? ''}:${errorMessage(error).replace(/\d+/g, '#')}`;
      const entry = seen.get(key);
      const at = now();
      if (entry && at - entry.reportedAt < REPORT_INTERVAL_MS) {
        entry.suppressed += 1;
        return { report: false, suppressed: 0 };
      }
      if (!entry && seen.size >= MAX_TRACKED_ERRORS) seen.clear();
      seen.set(key, { reportedAt: at, suppressed: 0 });
      return { report: true, suppressed: entry?.suppressed ?? 0 };
    },
  };
}
