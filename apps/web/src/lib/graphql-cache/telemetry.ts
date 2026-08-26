import { match } from 'ts-pattern';
import type { CacheRequest } from './protocol';

/** Fixed cache telemetry names. Dashboards must not accept ad-hoc names. */
export const CACHE_TELEMETRY_EVENT_NAMES = [
  'graphql_cache.wasm_download',
  'graphql_cache.wasm_compile',
  'graphql_cache.wasm_instantiate',
  'graphql_cache.schema_init',
  'graphql_cache.db_ready',
  'graphql_cache.host_ready',
  'graphql_cache.host_request',
  'graphql_cache.coordinator_request',
  'graphql_cache.engine_request',
  'graphql_cache.transaction',
  'graphql_cache.read',
  'graphql_cache.owner',
  'graphql_cache.stale_drop',
  'graphql_cache.lock_wait',
  'graphql_cache.storage_reset_required',
  'graphql_cache.logical_reset',
  'graphql_cache.revision_advance',
  'graphql_cache.reset_wipe',
  'graphql_cache.origin_storage_pressure',
  'graphql_cache.linear_memory',
  'graphql_cache.queue_diagnostics',
  'graphql_cache.navigation',
  'graphql_cache.aggregate',
] as const;

export type CacheTelemetryEventName =
  (typeof CACHE_TELEMETRY_EVENT_NAMES)[number];

export const CACHE_OPERATION_CATEGORIES = [
  'initialization',
  'read',
  'write',
  'transaction',
  'queue',
  'inspection',
  'invalidation',
  'lifecycle',
  'storage',
  'navigation',
  'unknown',
] as const;
export type CacheOperationCategory =
  (typeof CACHE_OPERATION_CATEGORIES)[number];

export const CACHE_TELEMETRY_OUTCOMES = [
  'success',
  'error',
  'hit',
  'miss',
  'graceful',
  'abrupt',
  'granted',
  'denied',
  'unknown',
] as const;
export type CacheTelemetryOutcome = (typeof CACHE_TELEMETRY_OUTCOMES)[number];

export const CACHE_OPEN_OUTCOMES = [
  'opened-existing',
  'opened-new',
  'reset-incompatible',
  'reset-corrupt',
  'reset-storage-uncertain',
] as const;
export type CacheOpenOutcome = (typeof CACHE_OPEN_OUTCOMES)[number];

export const CACHE_QUEUE_DIAGNOSTICS_AVAILABILITY = [
  'available',
  'unavailable',
] as const;
export type CacheQueueDiagnosticsAvailability =
  (typeof CACHE_QUEUE_DIAGNOSTICS_AVAILABILITY)[number];

export const CACHE_REVISION_CATEGORIES = [
  'authoritative-write',
  'optimistic-enqueue',
  'optimistic-commit',
  'optimistic-rollback',
  'external-invalidation',
  'deletion',
  'clear',
] as const;
export type CacheRevisionCategory = (typeof CACHE_REVISION_CATEGORIES)[number];

/** Payload-free, bounded error classes shared by all cache layers. */
export const CACHE_ERROR_CODES = [
  'none',
  'unsupported',
  'timeout',
  'wasm-download',
  'wasm-compile',
  'wasm-instantiate',
  'schema',
  'integrity',
  'opfs-unavailable',
  'opfs-quota',
  'opfs-io',
  'lock',
  'owner-lost',
  'protocol',
  'transport',
  'storage-reset',
  'initialization',
  'unknown',
] as const;
export type CacheErrorCode = (typeof CACHE_ERROR_CODES)[number];

export const CACHE_RESET_REASONS = [
  'explicit-clear',
  'identity-change',
  'namespace-mismatch',
  'integrity-failure',
  'storage-reset-required',
  'abrupt-owner-loss',
  'storage-eviction',
  'quota-failure',
  'unknown',
] as const;
export type CacheResetReason = (typeof CACHE_RESET_REASONS)[number];

export const CACHE_OWNER_EVENTS = [
  'elected',
  'activated',
  'graceful-drain-started',
  'graceful-drain-completed',
  'navigation-departure',
  'abrupt-loss',
  'replacement',
  'multiple-owner-detected',
] as const;
export type CacheOwnerEvent = (typeof CACHE_OWNER_EVENTS)[number];

export const CACHE_ROLLOUT_COHORTS = [
  'control',
  'treatment',
  'override',
  'unknown',
] as const;
export type CacheRolloutCohort = (typeof CACHE_ROLLOUT_COHORTS)[number];

export type CacheTelemetryObservation = {
  name: CacheTelemetryEventName;
  /** Original fixed event name represented by an aggregate envelope. */
  aggregatedEventName?: CacheTelemetryEventName;
  operationCategory: CacheOperationCategory;
  outcome?: CacheTelemetryOutcome;
  errorCode?: CacheErrorCode;
  resetReason?: CacheResetReason;
  ownerEvent?: CacheOwnerEvent;
  persistence?: 'granted' | 'denied' | 'unknown';
  openOutcome?: CacheOpenOutcome;
  queueDiagnosticsAvailability?: CacheQueueDiagnosticsAvailability;
  revisionCategory?: CacheRevisionCategory;
  resetAttempt?: 'wipe-before-open';
  durationMs?: number;
  bytes?: number;
  highWaterBytes?: number;
  usageBytes?: number;
  quotaBytes?: number;
  ratio?: number;
  count?: number;
  sampleRate?: number;
  queueDepth?: number;
  oldestAgeMs?: number;
};

/** The only cohort/browser/backend dimensions permitted on exported events. */
export type CacheTelemetryContext = {
  browserFamily: 'chromium' | 'firefox' | 'safari' | 'other';
  browserVersion: string;
  appVersion: string;
  backend: 'turso-wasm-opfs';
  rolloutCohort: CacheRolloutCohort;
};

export type CacheTelemetryEnvelope = Readonly<
  CacheTelemetryContext & CacheTelemetryObservation
>;

export interface CacheTelemetryObservationSink {
  emit(observation: CacheTelemetryObservation): void;
}

export interface CacheTelemetrySink {
  emit(event: CacheTelemetryEnvelope): void;
}

export interface CacheTelemetryRecorderLike {
  record(observation: CacheTelemetryObservation): void;
  flush(): void;
}

const HIGH_VOLUME_NAMES = new Set<CacheTelemetryEventName>([
  'graphql_cache.host_request',
  'graphql_cache.coordinator_request',
  'graphql_cache.engine_request',
  'graphql_cache.transaction',
  'graphql_cache.read',
]);

const boundedNumber = (
  value: number | undefined,
  maximum = Number.MAX_SAFE_INTEGER
): number | undefined =>
  value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.min(value, maximum)
    : undefined;

function sanitizeObservation(
  input: CacheTelemetryObservation
): CacheTelemetryObservation | undefined {
  if (!CACHE_TELEMETRY_EVENT_NAMES.includes(input.name)) return;
  if (!CACHE_OPERATION_CATEGORIES.includes(input.operationCategory)) return;

  return {
    name: input.name,
    ...(input.name === 'graphql_cache.aggregate' &&
    input.aggregatedEventName !== undefined &&
    HIGH_VOLUME_NAMES.has(input.aggregatedEventName)
      ? { aggregatedEventName: input.aggregatedEventName }
      : {}),
    operationCategory: input.operationCategory,
    ...(input.outcome !== undefined &&
    CACHE_TELEMETRY_OUTCOMES.includes(input.outcome)
      ? { outcome: input.outcome }
      : {}),
    ...(input.errorCode !== undefined &&
    CACHE_ERROR_CODES.includes(input.errorCode)
      ? { errorCode: input.errorCode }
      : {}),
    ...(input.resetReason !== undefined &&
    CACHE_RESET_REASONS.includes(input.resetReason)
      ? { resetReason: input.resetReason }
      : {}),
    ...(input.ownerEvent !== undefined &&
    CACHE_OWNER_EVENTS.includes(input.ownerEvent)
      ? { ownerEvent: input.ownerEvent }
      : {}),
    ...(input.persistence === 'granted' ||
    input.persistence === 'denied' ||
    input.persistence === 'unknown'
      ? { persistence: input.persistence }
      : {}),
    ...(input.openOutcome !== undefined &&
    CACHE_OPEN_OUTCOMES.includes(input.openOutcome)
      ? { openOutcome: input.openOutcome }
      : {}),
    ...(input.queueDiagnosticsAvailability !== undefined &&
    CACHE_QUEUE_DIAGNOSTICS_AVAILABILITY.includes(
      input.queueDiagnosticsAvailability
    )
      ? {
          queueDiagnosticsAvailability: input.queueDiagnosticsAvailability,
        }
      : {}),
    ...(input.revisionCategory !== undefined &&
    CACHE_REVISION_CATEGORIES.includes(input.revisionCategory)
      ? { revisionCategory: input.revisionCategory }
      : {}),
    ...(input.resetAttempt === 'wipe-before-open'
      ? { resetAttempt: input.resetAttempt }
      : {}),
    ...(boundedNumber(input.durationMs, 3_600_000) !== undefined
      ? { durationMs: boundedNumber(input.durationMs, 3_600_000) }
      : {}),
    ...(boundedNumber(input.bytes) !== undefined
      ? { bytes: boundedNumber(input.bytes) }
      : {}),
    ...(boundedNumber(input.highWaterBytes) !== undefined
      ? { highWaterBytes: boundedNumber(input.highWaterBytes) }
      : {}),
    ...(boundedNumber(input.usageBytes) !== undefined
      ? { usageBytes: boundedNumber(input.usageBytes) }
      : {}),
    ...(boundedNumber(input.quotaBytes) !== undefined
      ? { quotaBytes: boundedNumber(input.quotaBytes) }
      : {}),
    ...(boundedNumber(input.ratio, 1) !== undefined
      ? { ratio: boundedNumber(input.ratio, 1) }
      : {}),
    ...(boundedNumber(input.count) !== undefined
      ? { count: boundedNumber(input.count) }
      : {}),
    ...(boundedNumber(input.sampleRate) !== undefined
      ? { sampleRate: boundedNumber(input.sampleRate) }
      : {}),
    ...(boundedNumber(input.queueDepth) !== undefined
      ? { queueDepth: boundedNumber(input.queueDepth) }
      : {}),
    ...(boundedNumber(input.oldestAgeMs, 31_536_000_000) !== undefined
      ? { oldestAgeMs: boundedNumber(input.oldestAgeMs, 31_536_000_000) }
      : {}),
  };
}

type Aggregate = {
  template: CacheTelemetryObservation;
  count: number;
  totalDurationMs: number;
};

/**
 * Exception-isolated recorder. High-volume successes are counted in bounded
 * aggregates and sampled; every error remains individually visible.
 */
export class CacheTelemetryRecorder implements CacheTelemetryRecorderLike {
  private readonly sampleSequences = new Map<string, number>();
  private readonly aggregates = new Map<string, Aggregate>();

  constructor(
    private readonly sink: CacheTelemetryObservationSink,
    private readonly sampleRate = 100,
    private readonly aggregateEvery = 50
  ) {}

  record(input: CacheTelemetryObservation): void {
    try {
      const observation = sanitizeObservation(input);
      if (!observation) return;
      if (!HIGH_VOLUME_NAMES.has(observation.name)) {
        this.safeEmit(observation);
        return;
      }
      const isError =
        observation.outcome === 'error' ||
        observation.errorCode === 'owner-lost';
      if (isError) {
        // Make the denominator current before the raw error is observable.
        // Matching successes remain counted exactly once in aggregates.
        this.flushMatchingSuccesses(observation);
        this.safeEmit({ ...observation, sampleRate: 1 });
        return;
      }

      const key = JSON.stringify([
        observation.name,
        observation.operationCategory,
        observation.outcome ?? 'unknown',
        observation.errorCode ?? 'none',
      ]);
      const aggregate = this.aggregates.get(key) ?? {
        template: observation,
        count: 0,
        totalDurationMs: 0,
      };
      const weight = observation.count ?? 1;
      aggregate.count += weight;
      aggregate.totalDurationMs += (observation.durationMs ?? 0) * weight;
      this.aggregates.set(key, aggregate);
      if (aggregate.count >= this.aggregateEvery) this.flushOne(key, aggregate);

      const sampleSequence = (this.sampleSequences.get(key) ?? 0) + 1;
      this.sampleSequences.set(key, sampleSequence);
      const mustEmit =
        this.sampleRate <= 1 || sampleSequence % this.sampleRate === 0;
      if (mustEmit) {
        this.safeEmit({
          ...observation,
          sampleRate: this.sampleRate,
        });
      }
    } catch {
      // Telemetry is deliberately unable to affect cache correctness.
    }
  }

  flush(): void {
    try {
      for (const [key, aggregate] of this.aggregates) {
        this.flushOne(key, aggregate);
      }
    } catch {
      // A broken sink must not escape lifecycle cleanup.
    }
  }

  private flushMatchingSuccesses(error: CacheTelemetryObservation): void {
    for (const [key, aggregate] of this.aggregates) {
      if (aggregate.template.name === error.name) {
        this.flushOne(key, aggregate);
      }
    }
  }

  private flushOne(key: string, aggregate: Aggregate): void {
    this.aggregates.delete(key);
    const durationMs =
      aggregate.count > 0
        ? aggregate.totalDurationMs / aggregate.count
        : undefined;
    this.safeEmit({
      name: 'graphql_cache.aggregate',
      aggregatedEventName: aggregate.template.name,
      operationCategory: aggregate.template.operationCategory,
      outcome: aggregate.template.outcome,
      errorCode: aggregate.template.errorCode,
      count: aggregate.count,
      durationMs,
      sampleRate: 1,
    });
  }

  private safeEmit(observation: CacheTelemetryObservation): void {
    try {
      this.sink.emit(observation);
    } catch {
      // Failure isolation is part of the telemetry contract.
    }
  }
}

/** Adds allowlisted runtime dimensions and strips every unknown property. */
export class CacheTelemetryReporter implements CacheTelemetryObservationSink {
  private readonly context: CacheTelemetryContext;

  constructor(
    context: CacheTelemetryContext,
    private readonly sink: CacheTelemetrySink
  ) {
    this.context = {
      browserFamily: ['chromium', 'firefox', 'safari', 'other'].includes(
        context.browserFamily
      )
        ? context.browserFamily
        : 'other',
      browserVersion: /^\d{1,3}$/.test(context.browserVersion)
        ? context.browserVersion
        : 'unknown',
      appVersion: /^\d+\.\d+$/.test(context.appVersion)
        ? context.appVersion.slice(0, 16)
        : 'unknown',
      backend: 'turso-wasm-opfs',
      rolloutCohort: CACHE_ROLLOUT_COHORTS.includes(context.rolloutCohort)
        ? context.rolloutCohort
        : 'unknown',
    };
  }

  emit(input: CacheTelemetryObservation): void {
    try {
      const observation = sanitizeObservation(input);
      if (!observation) return;
      this.sink.emit(Object.freeze({ ...this.context, ...observation }));
    } catch {
      // Export failure cannot change request, transaction, or lifecycle state.
    }
  }
}

export const NOOP_CACHE_TELEMETRY: CacheTelemetryRecorderLike = Object.freeze({
  record: () => undefined,
  flush: () => undefined,
});

/** Wraps even an untrusted injected recorder in the correctness firewall. */
export function isolateCacheTelemetry(
  recorder: CacheTelemetryRecorderLike | undefined
): CacheTelemetryRecorderLike {
  if (!recorder) return NOOP_CACHE_TELEMETRY;
  return {
    record(observation): void {
      try {
        recorder.record(observation);
      } catch {
        // Injected sinks have the same failure-isolation contract as OTel.
      }
    },
    flush(): void {
      try {
        recorder.flush();
      } catch {
        // Cleanup remains independent from exporter behavior.
      }
    },
  };
}

export function operationCategoryForRequest(
  request: Pick<CacheRequest, 'kind'>
): CacheOperationCategory {
  return match(request.kind)
    .with('init', () => 'initialization' as const)
    .with(
      'read',
      'current-revision',
      'read-records-by-keys',
      'search',
      'entity-filter',
      () => 'read' as const
    )
    .with('write', 'hydrate', () => 'write' as const)
    .with(
      'enqueue-optimistic-mutation',
      'claim-next-mutation',
      'defer-optimistic-write',
      'commit-optimistic-write',
      'rollback-optimistic-write',
      () => 'transaction' as const
    )
    .with(
      'inspect-query',
      'inspect-query-variants',
      () => 'inspection' as const
    )
    .with('invalidate', 'delete-records', () => 'invalidation' as const)
    .with('teardown', 'clear', () => 'lifecycle' as const)
    .exhaustive();
}

export function isStorageTransactionRequest(
  request: Pick<CacheRequest, 'kind'>
): boolean {
  return [
    'write',
    'hydrate',
    'enqueue-optimistic-mutation',
    'claim-next-mutation',
    'defer-optimistic-write',
    'commit-optimistic-write',
    'rollback-optimistic-write',
    'invalidate',
    'delete-records',
    'clear',
  ].includes(request.kind);
}

/** Classifies an error without retaining or exporting its message. */
export function classifyCacheError(error: unknown): CacheErrorCode {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === 'string'
        ? error.toLowerCase()
        : '';
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('quota') || /\bfull\b/.test(message))
    return 'opfs-quota';
  if (message.includes('opfs') && message.includes('unavailable')) {
    return 'opfs-unavailable';
  }
  if (message.includes('opfs') || message.includes('wal')) return 'opfs-io';
  if (message.includes('lock')) return 'lock';
  if (message.includes('owner epoch') || message.includes('owner-lost')) {
    return 'owner-lost';
  }
  if (message.includes('protocol') || message.includes('envelope')) {
    return 'protocol';
  }
  if (message.includes('transport') || message.includes('messageport')) {
    return 'transport';
  }
  if (message.includes('schema') || message.includes('namespace')) {
    return 'schema';
  }
  if (message.includes('integrity') || message.includes('corrupt')) {
    return 'integrity';
  }
  if (message.includes('reset required')) return 'storage-reset';
  if (message.includes('wasm')) return 'wasm-instantiate';
  if (message.includes('initializ') || message.includes('open')) {
    return 'initialization';
  }
  return 'unknown';
}

export function resetReasonForError(error: unknown): CacheResetReason {
  const code = classifyCacheError(error);
  if (code === 'opfs-quota') return 'quota-failure';
  if (code === 'integrity') return 'integrity-failure';
  if (code === 'schema') return 'namespace-mismatch';
  if (code === 'owner-lost') return 'abrupt-owner-loss';
  return 'storage-reset-required';
}

export function browserCacheTelemetryContext(
  rolloutCohort: CacheRolloutCohort,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  appVersion = import.meta.env.__APP_VERSION__ ?? 'unknown'
): CacheTelemetryContext {
  const firefox = /Firefox\/(\d+(?:\.\d+)*)/i.exec(userAgent);
  const chromium = /(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/i.exec(userAgent);
  const safari =
    /Safari\//i.test(userAgent) && !chromium
      ? /Version\/(\d+(?:\.\d+)*)/i.exec(userAgent)
      : null;
  const match = firefox ?? chromium ?? safari;
  const browserFamily = firefox
    ? 'firefox'
    : chromium
      ? 'chromium'
      : safari
        ? 'safari'
        : 'other';
  const safeVersion = match?.[1]?.split('.')[0] ?? 'unknown';
  const appRelease = /^(\d+)\.(\d+)/.exec(appVersion);
  const safeAppVersion = appRelease
    ? `${appRelease[1]}.${appRelease[2]}`.slice(0, 16)
    : 'unknown';
  return {
    browserFamily,
    browserVersion: safeVersion,
    appVersion: safeAppVersion,
    backend: 'turso-wasm-opfs',
    rolloutCohort: CACHE_ROLLOUT_COHORTS.includes(rolloutCohort)
      ? rolloutCohort
      : 'unknown',
  };
}

export function isCacheTelemetryObservation(
  value: unknown
): value is CacheTelemetryObservation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = sanitizeObservation(value as CacheTelemetryObservation);
  if (!candidate) return false;
  return Object.keys(value).every((key) =>
    [
      'name',
      'aggregatedEventName',
      'operationCategory',
      'outcome',
      'errorCode',
      'resetReason',
      'ownerEvent',
      'persistence',
      'openOutcome',
      'queueDiagnosticsAvailability',
      'revisionCategory',
      'resetAttempt',
      'durationMs',
      'bytes',
      'highWaterBytes',
      'usageBytes',
      'quotaBytes',
      'ratio',
      'count',
      'sampleRate',
      'queueDepth',
      'oldestAgeMs',
    ].includes(key)
  );
}
