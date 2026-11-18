import { Telemetry } from '@macro-inc/observability';

type Activity =
  | 'predicate'
  | 'local'
  | 'authority-network'
  | 'authority-failed-network'
  | 'authority-local'
  | 'authority-stale-fallback'
  | 'stale-fallback'
  | 'generation';

type Sample = {
  durationMs?: number;
  rows?: number;
  upserts?: number;
  patches?: number;
  removed?: number;
  retries?: number;
  error?: boolean;
  incomplete?: boolean;
  discarded?: boolean;
};

const SUMMARY_INTERVAL_MS = 5 * 60_000;

/** One bounded owner for routine cache activity, shared by all Soup views.
 * Initial loading belongs to usePending. Updates only change numeric counters;
 * the next active sample after five minutes emits one summary. No per-view
 * timers, span trees, query names, revisions, or entity identifiers are retained.
 */
export function createSoupCacheTelemetry({
  now = () => performance.now(),
  report = (attributes: Record<string, number>) =>
    Telemetry.info('graphql_cache.soup_updates.summary', attributes),
}: {
  now?: () => number;
  report?: (attributes: Record<string, number>) => void;
} = {}) {
  const counters = new Map<Activity, Record<string, number>>();
  let startedAt = now();
  let nextReportAt = startedAt + SUMMARY_INTERVAL_MS;

  return {
    record(activity: Activity, sample: Sample = {}): void {
      const counts = counters.get(activity) ?? {};
      counts.count = (counts.count ?? 0) + 1;
      for (const key of ['upserts', 'patches', 'removed', 'retries'] as const)
        counts[key] = (counts[key] ?? 0) + (sample[key] ?? 0);
      counts.incomplete =
        (counts.incomplete ?? 0) + Number(sample.incomplete ?? false);
      counts.errors = (counts.errors ?? 0) + Number(sample.error ?? false);
      counts.discarded =
        (counts.discarded ?? 0) + Number(sample.discarded ?? false);
      if (sample.durationMs !== undefined) {
        counts.duration_total_ms =
          (counts.duration_total_ms ?? 0) + sample.durationMs;
        counts.duration_max_ms = Math.max(
          counts.duration_max_ms ?? 0,
          sample.durationMs
        );
      }
      if (sample.rows !== undefined) {
        counts.rows_total = (counts.rows_total ?? 0) + sample.rows;
        counts.rows_max = Math.max(counts.rows_max ?? 0, sample.rows);
      }
      counters.set(activity, counts);
      const time = now();
      if (time < nextReportAt) return;
      nextReportAt = time + SUMMARY_INTERVAL_MS;
      const attributes: Record<string, number> = {
        'cache.summary_interval_ms': time - startedAt,
      };
      for (const [kind, values] of counters)
        for (const [key, value] of Object.entries(values))
          attributes[`cache.${kind}.${key}`] = value;
      try {
        report(attributes);
        counters.clear();
        startedAt = time;
      } catch {
        // Keep the counters for the next interval. Export failure must never
        // reject a cache read or retry logging at the cache-update frequency.
      }
    },
  };
}

export const soupCacheTelemetry = createSoupCacheTelemetry();
