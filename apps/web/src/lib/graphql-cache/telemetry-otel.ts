import { Telemetry } from '@macro-inc/observability';
import type { CacheTelemetryEnvelope, CacheTelemetrySink } from './telemetry';

/**
 * Privacy-safe OpenTelemetry adapter. It uses the anonymous span API so the
 * browser provider cannot enrich cache metrics with `usr.id`.
 */
export function createOtelCacheTelemetrySink(): CacheTelemetrySink {
  return {
    emit(event: CacheTelemetryEnvelope): void {
      try {
        const span = Telemetry.anonymousSpan(event.name);
        span.setAttr('cache.browser_family', event.browserFamily);
        span.setAttr('cache.browser_version', event.browserVersion);
        span.setAttr('cache.app_version', event.appVersion);
        span.setAttr('cache.backend', event.backend);
        span.setAttr('cache.rollout_cohort', event.rolloutCohort);
        span.setAttr('cache.operation_category', event.operationCategory);
        const optionalAttributes = [
          ['cache.aggregated_event_name', event.aggregatedEventName],
          ['cache.outcome', event.outcome],
          ['cache.error_code', event.errorCode],
          ['cache.reset_reason', event.resetReason],
          ['cache.owner_event', event.ownerEvent],
          ['cache.persistence', event.persistence],
          ['cache.open_outcome', event.openOutcome],
          [
            'cache.queue_diagnostics_availability',
            event.queueDiagnosticsAvailability,
          ],
          ['cache.revision_category', event.revisionCategory],
          ['cache.reset_attempt', event.resetAttempt],
          ['cache.duration_ms', event.durationMs],
          ['cache.bytes', event.bytes],
          ['cache.high_water_bytes', event.highWaterBytes],
          ['cache.usage_bytes', event.usageBytes],
          ['cache.quota_bytes', event.quotaBytes],
          ['cache.ratio', event.ratio],
          ['cache.count', event.count],
          ['cache.sample_rate', event.sampleRate],
          ['cache.queue_depth', event.queueDepth],
          ['cache.oldest_age_ms', event.oldestAgeMs],
        ] as const;
        for (const [name, value] of optionalAttributes) {
          if (value !== undefined) span.setAttr(name, value);
        }
        try {
          recordSlowQuery(span);
        } finally {
          span.end();
        }
      } catch {
        // OTel availability and exporter failures never affect cache behavior.
      }

      function recordSlowQuery(
        span: ReturnType<typeof Telemetry.anonymousSpan>
      ) {
        if (event.name === 'graphql_cache.slow_query') {
          const attributes = {
            'db.system.name': 'sqlite',
            'db.query.fingerprint': event.queryFingerprint,
            'cache.backend': event.backend,
            'cache.duration_ms': event.durationMs,
            'cache.outcome': event.outcome,
            'cache.slow_query_threshold_ms': 200,
          };
          for (const [key, value] of Object.entries(attributes)) {
            if (value !== undefined) span.setAttr(key, value);
          }
          // Preserve the cache privacy contract on the log as well as the span.
          span.run(() =>
            Telemetry.warn('graphql_cache.slow_query', attributes)
          );
        }
      }
    },
  };
}
