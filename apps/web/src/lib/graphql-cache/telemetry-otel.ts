import { Telemetry } from '@macro-inc/observability';
import {
  CACHE_SCHEMA_CHANGES,
  CACHE_SCHEMA_RESET_REASONS,
  type CacheTelemetryEnvelope,
  type CacheTelemetrySink,
} from './telemetry';

type CacheSpan = ReturnType<typeof Telemetry.anonymousSpan>;

type SchemaAttributes = Pick<
  CacheTelemetryEnvelope,
  | 'schemaChange'
  | 'schemaResetReason'
  | 'schemaChangedTypes'
  | 'schemaDroppedRecords'
  | 'schemaIncompleteDocuments'
  | 'schemaRetiredOverlays'
  | 'schemaAdoptMs'
>;

/** What bringing the opened records to the build's schema did, when set. */
function setSchemaAttributes(span: CacheSpan, event: SchemaAttributes): void {
  const attributes = {
    'cache.schema.change': event.schemaChange,
    'cache.schema.reset_reason': event.schemaResetReason,
    'cache.schema.changed_types': event.schemaChangedTypes,
    'cache.schema.dropped_records': event.schemaDroppedRecords,
    'cache.schema.incomplete_documents': event.schemaIncompleteDocuments,
    'cache.schema.retired_overlays': event.schemaRetiredOverlays,
    'cache.schema.adopt_ms': event.schemaAdoptMs,
  };
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) span.setAttr(key, value);
  }
}

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
        if (event.errorName !== undefined) {
          span.setAttr('cache.error_name', event.errorName);
        }
        if (event.errorDetail !== undefined) {
          span.setAttr('cache.error_detail', event.errorDetail);
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
        setSchemaAttributes(span, event);
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
        if (event.walFrames !== undefined) {
          span.setAttr('cache.wal_frames', event.walFrames);
        }
        if (event.requestKind !== undefined) {
          span.setAttr('cache.request_kind', event.requestKind);
        }
        if (event.queueWaitMs !== undefined) {
          span.setAttr('cache.queue_wait_ms', event.queueWaitMs);
        }
        try {
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
        } finally {
          span.end();
        }
      } catch {
        // OTel availability and exporter failures never affect cache behavior.
      }
    },
  };
}

/** What the native host's open did to its cache, as
 * `graphql_cache_init_with_schema` resolves it (`SchemaInit` in the plugin). */
export type NativeSchemaInit = {
  change: string;
  resetReason?: string;
  changedTypes: number;
  droppedRecords: number;
  incompleteDocuments: number;
  retiredOverlays: number;
  adoptMs: number;
  physicalReset: boolean;
  storageUpgradedFrom?: number;
};

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, Number.MAX_SAFE_INTEGER)
    : undefined;

/**
 * Records a native open as `graphql_cache.schema_init`, the event the browser
 * worker records through the cache telemetry recorder, with the same schema
 * attributes; the native host runs no recorder, and native spans stay on the
 * device. Values outside the known names are left out.
 */
export function emitNativeSchemaInit(report: NativeSchemaInit): void {
  try {
    const span = Telemetry.anonymousSpan('graphql_cache.schema_init');
    try {
      span.setAttr('cache.backend', 'turso-native');
      span.setAttr('cache.operation_category', 'initialization');
      span.setAttr('cache.outcome', 'success');
      setSchemaAttributes(span, {
        schemaChange: CACHE_SCHEMA_CHANGES.find(
          (change) => change === report.change
        ),
        schemaResetReason: CACHE_SCHEMA_RESET_REASONS.find(
          (reason) => reason === report.resetReason
        ),
        schemaChangedTypes: count(report.changedTypes),
        schemaDroppedRecords: count(report.droppedRecords),
        schemaIncompleteDocuments: count(report.incompleteDocuments),
        schemaRetiredOverlays: count(report.retiredOverlays),
        schemaAdoptMs: count(report.adoptMs),
      });
      span.setAttr(
        'cache.schema.physical_reset',
        report.physicalReset === true
      );
      const upgradedFrom = count(report.storageUpgradedFrom);
      if (upgradedFrom !== undefined) {
        span.setAttr('cache.storage.upgraded_from', upgradedFrom);
      }
    } finally {
      span.end();
    }
  } catch {
    // OTel availability and exporter failures never affect cache behavior.
  }
}
