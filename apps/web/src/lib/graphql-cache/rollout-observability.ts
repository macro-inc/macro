import { isTauri } from '@core/util/platform';
import { getBrowserTursoCacheRolloutDecision } from './rollout';
import { createPageCacheTelemetry } from './telemetry-relay';

/** Records the navigation control/treatment point without starting cache I/O. */
export function recordBrowserTursoCacheNavigation(): void {
  if (isTauri()) return;
  try {
    const decision = getBrowserTursoCacheRolloutDecision();
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    const pageTelemetry = createPageCacheTelemetry({
      rolloutCohort: decision.cohort,
    });
    pageTelemetry.recorder.record({
      name: 'graphql_cache.navigation',
      operationCategory: 'navigation',
      outcome: 'success',
      errorCode: 'none',
      durationMs: navigation?.duration ?? 0,
    });
    pageTelemetry.recorder.flush();
    pageTelemetry.relay.dispose();
  } catch {
    // Navigation telemetry is observational and must never delay rendering.
  }
}
