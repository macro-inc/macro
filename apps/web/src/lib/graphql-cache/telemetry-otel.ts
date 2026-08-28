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
        if (event.aggregatedEventName !== undefined) {
          span.setAttr(
            'cache.aggregated_event_name',
            event.aggregatedEventName
          );
        }
        if (event.outcome !== undefined) {
          span.setAttr('cache.outcome', event.outcome);
        }
        if (event.errorCode !== undefined) {
          span.setAttr('cache.error_code', event.errorCode);
        }
        if (event.resetReason !== undefined) {
          span.setAttr('cache.reset_reason', event.resetReason);
        }
        if (event.ownerEvent !== undefined) {
          span.setAttr('cache.owner_event', event.ownerEvent);
        }
        if (event.persistence !== undefined) {
          span.setAttr('cache.persistence', event.persistence);
        }
        if (event.openOutcome !== undefined) {
          span.setAttr('cache.open_outcome', event.openOutcome);
        }
        if (event.queueDiagnosticsAvailability !== undefined) {
          span.setAttr(
            'cache.queue_diagnostics_availability',
            event.queueDiagnosticsAvailability
          );
        }
        if (event.revisionCategory !== undefined) {
          span.setAttr('cache.revision_category', event.revisionCategory);
        }
        if (event.resetAttempt !== undefined) {
          span.setAttr('cache.reset_attempt', event.resetAttempt);
        }
        if (event.durationMs !== undefined) {
          span.setAttr('cache.duration_ms', event.durationMs);
        }
        if (event.bytes !== undefined) span.setAttr('cache.bytes', event.bytes);
        if (event.highWaterBytes !== undefined) {
          span.setAttr('cache.high_water_bytes', event.highWaterBytes);
        }
        if (event.usageBytes !== undefined) {
          span.setAttr('cache.usage_bytes', event.usageBytes);
        }
        if (event.quotaBytes !== undefined) {
          span.setAttr('cache.quota_bytes', event.quotaBytes);
        }
        if (event.ratio !== undefined) span.setAttr('cache.ratio', event.ratio);
        if (event.count !== undefined) span.setAttr('cache.count', event.count);
        if (event.sampleRate !== undefined) {
          span.setAttr('cache.sample_rate', event.sampleRate);
        }
        if (event.queueDepth !== undefined) {
          span.setAttr('cache.queue_depth', event.queueDepth);
        }
        if (event.oldestAgeMs !== undefined) {
          span.setAttr('cache.oldest_age_ms', event.oldestAgeMs);
        }
        span.end();
      } catch {
        // OTel availability and exporter failures never affect cache behavior.
      }
    },
  };
}
