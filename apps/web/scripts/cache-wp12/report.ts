import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WP12_REQUIRED_ALERTS = [
  'init-open-failure',
  'reset-wipe-rate',
  'transaction-failure',
  'crash-owner-churn',
  'host-request-p95',
  'navigation-regression-p95',
  'linear-memory-p95',
  'origin-storage-pressure-p95',
] as const;

const REQUIRED_SCENARIOS = [
  'harnessControlLazyResourceEvidence',
  'treatmentLazyResources',
  'navigationResourceGate',
  'productionGraphqlSoupDefaultOffNoResources',
  'posthogTreatmentOverrideExactResources',
  'nextNavigationEmergencyDisableNoResources',
  'posthogNetworkSuppressed',
  'samePageStandbyHostCloseOwnerStable',
  'realStandbyTabCloseOwnerStable',
  'cleanOwnerRestartOfflineHit',
  'identityChangeReset',
  'realLogoutReset',
  'gracefulPreserve',
  'abruptLossWipe',
  'crossOriginIsolationNotRequired',
  'sharedArrayBufferNotCreated',
  'admittedMutatingRpcTerminationWipesNoReplay',
  'incompatibleNamespaceRecovery',
  'corruptQueuePayloadRecovery',
  'queueDiagnosticsTelemetry',
  'initializationRecoveryOutcomeTelemetry',
  'workerMemoryApiUnavailableWithoutIsolation',
] as const;

const REQUIRED_EVIDENCE_TESTS = [
  'lifecycle',
  'real-standby',
  'logout',
  'production-default-off',
  'posthog-treatment',
  'mutating-termination',
  'recovery-test-artifact',
] as const;

const REQUIRED_EVENT_NAMES = [
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
  'graphql_cache.reset_wipe',
  'graphql_cache.origin_storage_pressure',
  'graphql_cache.linear_memory',
  'graphql_cache.queue_diagnostics',
  'graphql_cache.navigation',
  'graphql_cache.aggregate',
] as const;

const REQUIRED_DIMENSIONS = [
  'browserFamily',
  'browserVersion',
  'appVersion',
  'backend',
  'rolloutCohort',
  'operationCategory',
] as const;
const REQUIRED_CLASSIFICATIONS = [
  'outcome',
  'errorCode',
  'resetReason',
  'ownerEvent',
  'persistence',
  'openOutcome',
  'queueDiagnosticsAvailability',
  'resetAttempt',
  'aggregatedEventName',
] as const;
const REQUIRED_MEASUREMENTS = [
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
] as const;
const REQUIRED_FORBIDDEN_FIELDS = [
  'scope',
  'entityId',
  'documentId',
  'userId',
  'graphqlDocument',
  'graphqlVariables',
  'graphqlResult',
  'recordBytes',
  'databaseFilename',
  'operationName',
  'query',
  'variables',
  'result',
  'email',
  'authorization',
  'authToken',
] as const;

const AGGREGATION_CONTRACT = {
  logicalEventName:
    "event.name == 'graphql_cache.aggregate' ? event.aggregatedEventName : event.name",
  successCountWeight:
    "event.name == 'graphql_cache.aggregate' ? event.count : 0",
  rawErrorWeight:
    "event.name != 'graphql_cache.aggregate' && event.outcome == 'error' && event.sampleRate == 1 ? 1 : 0",
  sampleWeight:
    "event.name != 'graphql_cache.aggregate' ? (event.sampleRate || 1) : 0",
  errorRateFormula:
    'sum(rawErrorWeight) / (sum(rawErrorWeight) + sum(successCountWeight))',
  latencyFormula:
    'weighted_percentile(durationMs, sampleWeight, percentile) over non-aggregate events',
  aggregateDurationSemantics:
    'count-weighted arithmetic mean retained for mean-only panels; never used as a percentile sample',
  errorSampling: 'raw-errors-only-sampleRate-1-never-aggregated',
  minimumCountSemantics:
    'raw error count plus success aggregate count; percentile alerts use sum(sampleWeight)',
} as const;

const CANONICAL_QUERIES = [
  {
    id: 'db-ready-error-rate',
    event: 'graphql_cache.db_ready',
    selector: "operationCategory='initialization'",
    formula: "count(outcome='error') / count(all outcomes)",
    source: 'unsampled engine-runtime events',
    unit: 'ratio',
  },
  {
    id: 'storage-reset-required-per-db-ready',
    event: 'graphql_cache.storage_reset_required',
    selector: "outcome='error'",
    formula:
      'count(storage_reset_required) / count(graphql_cache.db_ready)',
    source: 'unsampled authoritative coordinator reset events',
    unit: 'ratio',
  },
  {
    id: 'logical-reset-per-db-ready',
    event: 'graphql_cache.logical_reset',
    selector: "outcome='success'",
    formula: 'count(logical_reset) / count(graphql_cache.db_ready)',
    source: 'unsampled explicit-clear, identity-change, and authoritative coordinator recovery events',
    unit: 'ratio',
  },
  {
    id: 'reset-wipe-execution-per-db-ready',
    event: 'graphql_cache.reset_wipe',
    selector: "outcome='success' or (outcome='error' and resetAttempt='wipe-before-open')",
    formula:
      'count(reset_wipe execution events) / count(graphql_cache.db_ready)',
    source: 'unsampled authoritative coordinator reset proof/failure events',
    unit: 'ratio',
  },
  {
    id: 'reset-wipe-execution-failure-rate',
    event: 'graphql_cache.reset_wipe',
    selector: "outcome='success' or (outcome='error' and resetAttempt='wipe-before-open')",
    formula:
      "count(outcome='error') / count(reset_wipe execution events)",
    source: "unsampled coordinator events; failures require resetAttempt='wipe-before-open'",
    unit: 'ratio',
  },
  {
    id: 'transaction-error-rate',
    event: 'graphql_cache.transaction',
    selector: "operationCategory in ['transaction','write']",
    formula: 'raw_errors / (raw_errors + success_aggregate_count)',
    source:
      "raw sampleRate=1 errors plus graphql_cache.aggregate successes where aggregatedEventName='graphql_cache.transaction'",
    unit: 'ratio',
  },
  {
    id: 'abrupt-loss-or-replacement-per-db-ready',
    event: 'graphql_cache.owner',
    selector: "ownerEvent in ['abrupt-loss','replacement']",
    formula:
      'count(selected owner events) / count(graphql_cache.db_ready)',
    source: 'physical coordinator events only',
    unit: 'ratio',
  },
  {
    id: 'host-request-duration-p95-ms',
    event: 'graphql_cache.host_request',
    selector:
      "outcome in ['success','error'] and name != 'graphql_cache.aggregate'",
    formula: 'weighted_percentile(durationMs, sampleRate || 1, 0.95)',
    source: 'sampled host end-to-end events; aggregates excluded',
    unit: 'milliseconds',
  },
  {
    id: 'treatment-minus-control-navigation-p95-ms',
    event: 'graphql_cache.navigation',
    selector: "rolloutCohort in ['control','treatment']",
    formula:
      "p95(durationMs where rolloutCohort='treatment') - p95(durationMs where rolloutCohort='control')",
    source:
      'unsampled production-wrapper events; minimum count applies to each cohort',
    unit: 'milliseconds',
  },
  {
    id: 'linear-memory-p95-bytes',
    event: 'graphql_cache.linear_memory',
    selector: "outcome='success'",
    formula: 'weighted_percentile(bytes, sampleRate || 1, 0.95)',
    source:
      'engine runtime ready, bounded-periodic, and drain observations',
    unit: 'bytes',
  },
  {
    id: 'queue-depth-max',
    event: 'graphql_cache.queue_diagnostics',
    selector: "outcome='success'",
    formula: 'max(queueDepth)',
    source: 'latest successful payload-free snapshot; bounded storage refresh only at initialization and rate-limited serialized mutation checkpoints; heartbeat/drain use cached data',
    unit: 'count',
  },
  {
    id: 'queue-oldest-age-p95-ms',
    event: 'graphql_cache.queue_diagnostics',
    selector: "outcome='success' and queueDepth > 0",
    formula: 'weighted_percentile(oldestAgeMs, sampleRate || 1, 0.95)',
    source: 'cached payload-free snapshot with oldest age recalculated at emission; empty/unavailable queues excluded',
    unit: 'milliseconds',
  },
  {
    id: 'origin-storage-usage-over-quota-p95',
    event: 'graphql_cache.origin_storage_pressure',
    selector: "outcome='success' and ratio is present",
    formula: 'weighted_percentile(ratio, sampleRate || 1, 0.95)',
    source:
      'host ready and bounded-periodic navigator.storage origin estimate; not OPFS-specific',
    unit: 'ratio',
  },
] as const;

const CANONICAL_QUERY_IDS = CANONICAL_QUERIES.map(({ id }) => id);
const CANONICAL_PANELS = [
  {
    id: 'initialization',
    queryIds: ['db-ready-error-rate'],
    statistics: ['count', 'error-rate', 'p50', 'p95', 'p99'],
  },
  {
    id: 'requests-and-transactions',
    queryIds: ['transaction-error-rate', 'host-request-duration-p95-ms'],
    statistics: ['count', 'outcome-rate', 'p50', 'p95', 'p99'],
  },
  {
    id: 'ownership-and-recovery',
    queryIds: [
      'storage-reset-required-per-db-ready',
      'logical-reset-per-db-ready',
      'reset-wipe-execution-per-db-ready',
      'reset-wipe-execution-failure-rate',
      'abrupt-loss-or-replacement-per-db-ready',
    ],
    statistics: ['count', 'rate', 'p95'],
  },
  {
    id: 'storage-and-memory',
    queryIds: [
      'origin-storage-usage-over-quota-p95',
      'linear-memory-p95-bytes',
    ],
    statistics: ['p50', 'p95', 'max', 'high-water'],
  },
  {
    id: 'queue-health',
    queryIds: ['queue-depth-max', 'queue-oldest-age-p95-ms'],
    statistics: ['max', 'p50', 'p95'],
  },
  {
    id: 'navigation',
    queryIds: ['treatment-minus-control-navigation-p95-ms'],
    statistics: ['p50', 'p95', 'p99', 'treatment-minus-control'],
  },
] as const;
const CANONICAL_PANEL_IDS = CANONICAL_PANELS.map(({ id }) => id);
const CANONICAL_DISABLED_ALERTS = [
  {
    id: 'total-worker-memory',
    enabled: false,
    reason:
      'measureUserAgentSpecificMemory requires cross-origin isolation and has no Firefox worker support; performance.memory is non-standard and absent in tested workers',
    prohibitedSubstitutes: [
      'origin storage usage',
      'process memory',
      'WASM linear memory',
    ],
  },
] as const;

const CANONICAL_ALERTS = [
  { id: 'init-open-failure', metric: 'db-ready-error-rate', windowMinutes: 15, minimumEvents: 100, warning: 0.01, critical: 0.03, unit: 'ratio', rollbackOnCritical: true },
  { id: 'reset-wipe-rate', metric: 'reset-wipe-execution-per-db-ready', windowMinutes: 15, minimumEvents: 100, warning: 0.005, critical: 0.01, unit: 'ratio', rollbackOnCritical: true },
  { id: 'transaction-failure', metric: 'transaction-error-rate', windowMinutes: 15, minimumEvents: 100, warning: 0.005, critical: 0.019, unit: 'ratio', rollbackOnCritical: true },
  { id: 'crash-owner-churn', metric: 'abrupt-loss-or-replacement-per-db-ready', windowMinutes: 10, minimumEvents: 50, warning: 0.1, critical: 0.25, unit: 'ratio', rollbackOnCritical: true },
  { id: 'host-request-p95', metric: 'host-request-duration-p95-ms', windowMinutes: 15, minimumEvents: 500, warning: 250, critical: 500, unit: 'milliseconds', rollbackOnCritical: true },
  { id: 'navigation-regression-p95', metric: 'treatment-minus-control-navigation-p95-ms', windowMinutes: 30, minimumEvents: 500, warning: 100, critical: 200, unit: 'milliseconds', rollbackOnCritical: true },
  { id: 'linear-memory-p95', metric: 'linear-memory-p95-bytes', windowMinutes: 30, minimumEvents: 100, warning: 26_843_546, critical: 33_554_432, unit: 'bytes', rollbackOnCritical: true },
  { id: 'origin-storage-pressure-p95', metric: 'origin-storage-usage-over-quota-p95', windowMinutes: 30, minimumEvents: 100, warning: 0.8, critical: 0.9, unit: 'ratio', rollbackOnCritical: true },
] as const;
const CANONICAL_ROLLBACK = {
  decision: 'automatic-on-any-critical-alert',
  target: 'disable-browser-turso-cache',
  targetValue: true,
  executor: 'external-approved-PostHog-automation-required',
  executorConfiguredInRepository: false,
  liveMutationVerified: false,
  failureMode: 'hold-browser-exposure-at-zero',
  activeSessionBehavior:
    'browser Turso client continues through settlement; kill applies on next reload/navigation; Tauri GraphQL gate remains dynamic',
  maximumEmergencyEffectDelay: 'one active browser page-session lifetime',
  reenable: 'human-approval-required-after-one-clean-soak-window',
  priorVersionRetention: { minimumReleases: 2, minimumHours: 168 },
} as const;
const CANONICAL_ROLLOUT_STAGES = [
  { name: 'internal', maximumPercent: 1, minimumSoakHours: 24 },
  { name: 'canary', maximumPercent: 5, minimumSoakHours: 48 },
  { name: 'general', maximumPercent: 100, minimumSoakHours: 168 },
] as const;
const CANONICAL_ROLLOUT_STAGE_IDS = CANONICAL_ROLLOUT_STAGES.map(
  ({ name }) => name
);
const REQUIRED_PROMOTION_GATES = [
  'all alerts below warning for the complete soak window',
  'all required Section 10 matrix entries verified',
  'product-owner numeric budget acceptance',
  'latest stable macOS Safari external-runner evidence',
  'live S3/CloudFront delivery evidence before general exposure',
  'human approval',
] as const;

const ALERT_METRIC_UNITS = {
  'init-open-failure': ['db-ready-error-rate', 'ratio'],
  'reset-wipe-rate': ['reset-wipe-execution-per-db-ready', 'ratio'],
  'transaction-failure': ['transaction-error-rate', 'ratio'],
  'crash-owner-churn': [
    'abrupt-loss-or-replacement-per-db-ready',
    'ratio',
  ],
  'host-request-p95': ['host-request-duration-p95-ms', 'milliseconds'],
  'navigation-regression-p95': [
    'treatment-minus-control-navigation-p95-ms',
    'milliseconds',
  ],
  'linear-memory-p95': ['linear-memory-p95-bytes', 'bytes'],
  'origin-storage-pressure-p95': [
    'origin-storage-usage-over-quota-p95',
    'ratio',
  ],
} as const;

const KNOWN_PENDING_GAPS = [
  'active DedicatedWorker JS/native memory: measureUserAgentSpecificMemory requires cross-origin isolation and has no Firefox worker support',
  'provider dashboard deployment and executable query translation',
  'external PostHog kill-switch executor',
] as const;

const MATRIX_CASE_IDS = {
  '10.1': Array.from({ length: 12 }, (_, index) => `10.1.${index + 1}`),
  '10.2': Array.from({ length: 16 }, (_, index) => `10.2.${index + 1}`),
  '10.3': [
    '10.3.1',
    '10.3.2',
    '10.3.3',
    '10.3.4',
    '10.3.5',
    '10.3.6',
    '10.3.7',
    '10.3.8',
    '10.3.9',
    '10.3.10a',
    '10.3.10b',
    '10.3.10c',
    '10.3.10d',
    '10.3.10e',
    '10.3.10f',
    '10.3.11',
    '10.3.12',
    '10.3.13',
    '10.3.14',
  ],
  '10.4': [
    '10.4.1',
    '10.4.2',
    '10.4.3',
    '10.4.4',
    '10.4.4b',
    '10.4.5',
    '10.4.6',
  ],
} as const;

const MATRIX_SECTION_TITLES = {
  '10.1': 'Rust storage contract',
  '10.2': 'OPFS I/O tests',
  '10.3': 'Worker and multi-tab real-browser E2E',
  '10.4': 'Build and regression checks',
} as const;

// SHA-256 of the ordered [{ id, requirement, evidence }] inventory. This pins
// every requirement to its exact evidence list independently of status floors.
const CANONICAL_MATRIX_REQUIREMENT_EVIDENCE_SHA256 =
  '4bbafa8c7458636130b1b7b31a3012cb92f39c1f6dd885d6942cf82daae07a2c';

const MATRIX_STATUS = {
  ...Object.fromEntries(MATRIX_CASE_IDS['10.1'].map((id) => [id, 'verified-lower-level'])),
  ...Object.fromEntries(
    MATRIX_CASE_IDS['10.2'].map((id, index) => [
      id,
      index < 13
        ? 'verified-lower-level'
        : index < 15
          ? 'verified-real-browser-subset'
          : 'verified-lower-level-real-browser-pending',
    ])
  ),
  '10.4.1': 'verified-local',
  '10.4.2': 'verified-local',
  '10.4.3': 'verified-local',
  '10.4.4': 'verified-local',
  '10.4.4b': 'pending-local-composite-command',
  '10.4.5': 'verified-local',
  '10.4.6': 'verified-local-subset',
} as Record<string, string>;

const BROWSER_TARGETS = [
  'chromium',
  'firefox',
  'safari-latest-stable-macos',
] as const;
const NATIVE_TARGETS = [
  'tauri-unit',
  'tauri-real-native',
  'ios-real-native',
] as const;
const MATRIX_COVERAGE: Record<string, Record<string, string>> = {
  '10.3.1': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.2': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.3': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.4': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.5': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.6': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.7': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.8': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.9': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.10a': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.10b': { chromium: 'verified-real-browser-test-artifact', firefox: 'verified-real-browser-test-artifact', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.10c': { chromium: 'verified-real-browser-test-artifact', firefox: 'verified-real-browser-test-artifact', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.10d': { chromium: 'pending-real-browser', firefox: 'pending-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.10e': { chromium: 'pending-real-browser', firefox: 'pending-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.10f': { chromium: 'verified-real-browser', firefox: 'pending-real-browser-no-local-eviction-control', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.11': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.12': { 'tauri-unit': 'verified-unit', 'tauri-real-native': 'pending-real-native', 'ios-real-native': 'pending-real-native' },
  '10.3.13': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
  '10.3.14': { chromium: 'verified-real-browser', firefox: 'verified-real-browser', 'safari-latest-stable-macos': 'pending-external-runner' },
};

const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const WEB_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPOSITORY_ROOT = resolve(WEB_ROOT, '../..');

export type Wp12BrowserEvidence = {
  schemaVersion: 5;
  measuredAt: string;
  measuredRevisionChangeId: string;
  measuredSourceDigest: string;
  source: 'local-playwright-finalizer';
  project: 'chromium-production' | 'firefox-production';
  mode: 'production';
  finalizer: {
    kind: 'playwright-after-all';
    requiredTests: typeof REQUIRED_EVIDENCE_TESTS;
    completedTests: typeof REQUIRED_EVIDENCE_TESTS;
  };
  runner: {
    playwrightVersion: string;
    executablePath: string;
    executableSha256: string;
  };
  browser: {
    family: 'chromium' | 'firefox';
    executableVersion: string;
    userAgent: string;
  };
  origin: 'http://127.0.0.1:4189';
  exactProductionHost: true;
  exactProductionWorker: true;
  liveS3CloudFrontVerified: false;
  scenarios: Record<(typeof REQUIRED_SCENARIOS)[number], true>;
  resources: {
    wasm: {
      basename: string;
      url: string;
      expectedProductionUrl: string;
      sha256: string;
    };
    engineWorkerUrls: string[];
    coordinatorWorkerUrls: string[];
  };
  testArtifacts: {
    recoveryHooks: {
      classification: 'real-browser-test-artifact';
      productionArtifact: false;
      cargoFeature: 'browser-test-hooks';
      wasm: {
        basename: string;
        url: string;
        sha256: string;
      };
    };
  };
  navigation: { controlDurationMs: number; treatmentDurationMs: number };
};

export type Wp12Report = {
  schemaVersion: 5;
  measuredRevisionChangeId: string;
  measuredSourceDigest: string;
  status: 'candidate-local-subset-pass-exposure-blocked';
  exposurePercent: 0;
  productionDefault: 'off';
  telemetryContract: Record<string, unknown>;
  testMatrix: {
    path: 'ops/graphql-cache-wp12-test-matrix.json';
    status: 'inventory-validated-with-pending-real-browser-gates';
    pendingCoverageCount: number;
  };
  browsers: Wp12BrowserEvidence[];
  pending: string[];
  claims: {
    allLocalGatesPassed: false;
    productionWrapperDefaultOffBrowserVerified: true;
    realStandbyTabCloseVerified: true;
    realLogoutResetVerified: true;
    posthogTreatmentOverrideVerified: true;
    nextNavigationEmergencyDisableVerified: true;
    posthogNetworkRequestsObserved: false;
    admittedMutatingRpcTerminationVerified: true;
    incompatibleNamespaceRecoveryVerified: true;
    corruptQueuePayloadRecoveryVerified: true;
    queueDiagnosticsTelemetryVerified: true;
    initializationRecoveryOutcomeTelemetryVerified: true;
    totalWorkerMemoryTelemetryImplemented: false;
    safariVerified: false;
    liveS3CloudFrontVerified: false;
    posthogMutationPerformed: false;
    dashboardDeployed: false;
  };
};

type EvidenceValidationContext = {
  now: Date;
  expectedRevisionChangeId: string;
  expectedSourceDigest: string;
  expectedWasmSha256: string;
  executableSha256ByPath: Readonly<Record<string, string>>;
};

type AlertEvaluation = {
  state: 'insufficient-data' | 'normal' | 'warning' | 'critical';
  observedValue: number;
  eventCount: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const normalizedKey = (key: string): string =>
  key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase();
const exactArray = (actual: unknown, expected: readonly unknown[]): boolean =>
  Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
const exactObject = (actual: unknown, expected: unknown): boolean =>
  JSON.stringify(actual) === JSON.stringify(expected);

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).toSorted();
  const canonical = [...expected].toSorted();
  if (!exactArray(actual, canonical)) {
    throw new Error(`${label} has unknown or missing keys`);
  }
}

function assertUniqueInventory(
  values: readonly unknown[],
  expected: readonly string[],
  label: string,
  key = 'id'
): void {
  const ids = values.map((value) =>
    isRecord(value) && typeof value[key] === 'string' ? value[key] : ''
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} contains duplicate IDs`);
  }
  if (!exactArray(ids, expected)) {
    throw new Error(`${label} inventory is not canonical`);
  }
}

function rejectForbiddenFields(value: unknown): void {
  const forbidden = new Set(REQUIRED_FORBIDDEN_FIELDS.map(normalizedKey));
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) {
      if (forbidden.has(normalizedKey(key))) {
        throw new Error(`privacy-forbidden evidence field: ${key}`);
      }
      visit(entry);
    }
  };
  visit(value);
}

const requireFiniteNonNegative = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
};

const browserMajorFromUserAgent = (
  family: 'chromium' | 'firefox',
  userAgent: string
): string | undefined =>
  (family === 'chromium'
    ? /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent)
    : /Firefox\/(\d+)/.exec(userAgent))?.[1];

const SOURCE_DIGEST_INPUT_PATTERNS = [
  /^apps\/web\/src\//,
  /^apps\/web\/scripts\/cache-(?:wasm|wp12)\//,
  /^apps\/web\/ops\//,
  /^apps\/web\/(?:index\.html|justfile|package\.json)$/,
  /^apps\/web\/(?:vite|vitest|playwright)[^/]*\.ts$/,
  /^apps\/web\/tsconfig[^/]*\.json$/,
  /^packages\/observability\/src\//,
  /^packages\/observability\/(?:package\.json|tsconfig\.json|vitest\.config\.ts)$/,
  /^crates\//,
  /^\.cargo\//,
  /^(?:Cargo\.lock|Cargo\.toml|bun\.lock|bunfig\.toml|package\.json|rust-toolchain\.toml)$/,
] as const;

const isMeasuredSourceInput = (path: string): boolean => {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('crates/')) return true;
  if (
    /(?:^|\/)(?:measurements|docs?|\.?dist(?:-[^/]*)?)(?:\/|$)/i.test(
      normalized
    ) ||
    /\.md$/i.test(normalized)
  ) {
    return false;
  }
  return SOURCE_DIGEST_INPUT_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
};

/** List every tracked transitive input included in WP-12 evidence binding. */
export function listMeasuredSourceInputs(
  repositoryRoot = REPOSITORY_ROOT
): string[] {
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return tracked
    .split('\n')
    .filter(Boolean)
    .filter(isMeasuredSourceInput)
    .toSorted();
}

/** Digest path plus bytes for all tracked runtime/build/evidence inputs. */
export async function computeMeasuredSourceDigest(
  repositoryRoot = REPOSITORY_ROOT,
  trackedFiles = listMeasuredSourceInputs(repositoryRoot)
): Promise<string> {
  const files = [...new Set(trackedFiles.filter(isMeasuredSourceInput))].toSorted();
  if (files.length === 0) {
    throw new Error('WP-12 source digest has no tracked inputs');
  }
  const digest = createHash('sha256');
  for (const path of files) {
    digest.update(path);
    digest.update('\0');
    digest.update(await readFile(resolve(repositoryRoot, path)));
    digest.update('\0');
  }
  return digest.digest('hex');
}

/** Hash a real browser executable without loading it wholly into JS memory. */
export async function sha256File(path: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`executable is not a file: ${path}`);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

export function validateWp12BrowserEvidence(
  value: unknown,
  context: EvidenceValidationContext
): asserts value is Wp12BrowserEvidence {
  rejectForbiddenFields(value);
  if (!isRecord(value) || value.schemaVersion !== 5) {
    throw new Error('WP-12 browser evidence must use schemaVersion 5');
  }
  assertExactKeys(
    value,
    [
      'schemaVersion', 'measuredAt', 'measuredRevisionChangeId',
      'measuredSourceDigest', 'source', 'project', 'mode', 'finalizer',
      'runner', 'browser', 'origin', 'exactProductionHost',
      'exactProductionWorker', 'liveS3CloudFrontVerified', 'scenarios',
      'resources', 'testArtifacts', 'navigation',
    ],
    'browser evidence'
  );
  if (
    value.source !== 'local-playwright-finalizer' ||
    value.mode !== 'production'
  ) {
    throw new Error('WP-12 evidence must be finalized local production Playwright');
  }
  if (!isRecord(value.finalizer)) {
    throw new Error('WP-12 evidence requires an actual finalizer record');
  }
  assertExactKeys(
    value.finalizer,
    ['kind', 'requiredTests', 'completedTests'],
    'browser evidence finalizer'
  );
  if (
    value.finalizer.kind !== 'playwright-after-all' ||
    !exactArray(value.finalizer.requiredTests, REQUIRED_EVIDENCE_TESTS) ||
    !exactArray(value.finalizer.completedTests, REQUIRED_EVIDENCE_TESTS)
  ) {
    throw new Error('WP-12 evidence was not produced after every required test passed');
  }
  const measuredAt = Date.parse(String(value.measuredAt));
  const ageMs = context.now.getTime() - measuredAt;
  if (!Number.isFinite(measuredAt) || ageMs > MAX_EVIDENCE_AGE_MS || ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error('WP-12 evidence timestamp is invalid, stale, or future');
  }
  if (value.measuredRevisionChangeId !== context.expectedRevisionChangeId) {
    throw new Error('WP-12 evidence revision does not match measured revision');
  }
  if (value.measuredSourceDigest !== context.expectedSourceDigest) {
    throw new Error('WP-12 evidence source digest does not match runtime/config/report inputs');
  }
  if (!isRecord(value.runner) || !isRecord(value.browser)) {
    throw new Error('missing browser or runner evidence');
  }
  assertExactKeys(value.runner, ['playwrightVersion', 'executablePath', 'executableSha256'], 'runner evidence');
  assertExactKeys(value.browser, ['family', 'executableVersion', 'userAgent'], 'browser evidence identity');
  const family = value.browser.family;
  if (family !== 'chromium' && family !== 'firefox') {
    throw new Error('WP-12 local evidence supports Chromium/Firefox only');
  }
  if (value.project !== `${family}-production` || value.origin !== 'http://127.0.0.1:4189') {
    throw new Error('browser family/project/origin consistency check failed');
  }
  if (typeof value.browser.executableVersion !== 'string' || !/^\d+(?:\.\d+)*$/.test(value.browser.executableVersion)) {
    throw new Error('exact executable browser version is required');
  }
  if (typeof value.browser.userAgent !== 'string' || browserMajorFromUserAgent(family, value.browser.userAgent) !== value.browser.executableVersion.split('.')[0]) {
    throw new Error('browser executable/user-agent consistency check failed');
  }
  if (
    typeof value.runner.playwrightVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.runner.playwrightVersion) ||
    typeof value.runner.executablePath !== 'string' ||
    !isAbsolute(value.runner.executablePath) ||
    typeof value.runner.executableSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.runner.executableSha256) ||
    context.executableSha256ByPath[value.runner.executablePath] !== value.runner.executableSha256
  ) {
    throw new Error('Playwright executable path/hash/version verification failed');
  }
  if (value.exactProductionHost !== true || value.exactProductionWorker !== true) {
    throw new Error('treatment must use exact production host and worker');
  }
  if (value.liveS3CloudFrontVerified !== false) {
    throw new Error('local WP-12 evidence must not claim live S3/CloudFront');
  }
  if (
    !isRecord(value.scenarios) ||
    !isRecord(value.resources) ||
    !isRecord(value.testArtifacts)
  ) {
    throw new Error('missing WP-12 scenarios/resources/test artifacts');
  }
  const scenarios = value.scenarios;
  assertExactKeys(scenarios, REQUIRED_SCENARIOS, 'browser scenarios');
  if (REQUIRED_SCENARIOS.some((scenario) => scenarios[scenario] !== true)) {
    throw new Error('every claimed WP-12 scenario must be exactly true');
  }
  assertExactKeys(value.resources, ['wasm', 'engineWorkerUrls', 'coordinatorWorkerUrls'], 'browser resources');
  if (!isRecord(value.resources.wasm)) throw new Error('missing WASM artifact evidence');
  const wasm = value.resources.wasm;
  assertExactKeys(wasm, ['basename', 'url', 'expectedProductionUrl', 'sha256'], 'WASM evidence');
  if (
    typeof wasm.basename !== 'string' ||
    !/^cache_wasm_bg-[A-Za-z0-9_-]+\.wasm$/.test(wasm.basename) ||
    wasm.url !== `${value.origin}/app/assets/${wasm.basename}` ||
    wasm.expectedProductionUrl !== wasm.url ||
    wasm.sha256 !== context.expectedWasmSha256
  ) {
    throw new Error('WASM URL/hash differs from inspected WP-11 artifact');
  }
  const validateWorkerUrls = (candidate: unknown, pattern: RegExp): void => {
    if (!Array.isArray(candidate) || candidate.length !== 1 || typeof candidate[0] !== 'string' || !pattern.test(candidate[0])) {
      throw new Error('production worker URL invariant failed');
    }
  };
  validateWorkerUrls(value.resources.engineWorkerUrls, /^http:\/\/127\.0\.0\.1:4189\/app\/assets\/cache\.engine-worker-[A-Za-z0-9_-]+\.js$/);
  validateWorkerUrls(value.resources.coordinatorWorkerUrls, /^http:\/\/127\.0\.0\.1:4189\/app\/assets\/cache\.coordinator\.shared-worker-[A-Za-z0-9_-]+\.js$/);
  assertExactKeys(value.testArtifacts, ['recoveryHooks'], 'test artifacts');
  if (!isRecord(value.testArtifacts.recoveryHooks)) {
    throw new Error('missing recovery-hook test artifact');
  }
  const recoveryHooks = value.testArtifacts.recoveryHooks;
  assertExactKeys(
    recoveryHooks,
    ['classification', 'productionArtifact', 'cargoFeature', 'wasm'],
    'recovery-hook artifact'
  );
  if (
    recoveryHooks.classification !== 'real-browser-test-artifact' ||
    recoveryHooks.productionArtifact !== false ||
    recoveryHooks.cargoFeature !== 'browser-test-hooks' ||
    !isRecord(recoveryHooks.wasm)
  ) {
    throw new Error('recovery hooks must be a separate feature-gated test artifact');
  }
  assertExactKeys(recoveryHooks.wasm, ['basename', 'url', 'sha256'], 'recovery-hook WASM');
  const hookWasm = recoveryHooks.wasm;
  if (
    typeof hookWasm.basename !== 'string' ||
    !/^cache_wasm_browser_test_hooks_bg-[A-Za-z0-9_-]+\.wasm$/.test(
      hookWasm.basename
    ) ||
    hookWasm.url !== `${value.origin}/app/assets/${hookWasm.basename}` ||
    typeof hookWasm.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(hookWasm.sha256) ||
    hookWasm.sha256 === context.expectedWasmSha256
  ) {
    throw new Error('recovery-hook WASM identity/classification is invalid');
  }
  if (!isRecord(value.navigation)) throw new Error('navigation evidence missing');
  assertExactKeys(value.navigation, ['controlDurationMs', 'treatmentDurationMs'], 'navigation evidence');
  requireFiniteNonNegative(value.navigation.controlDurationMs, 'controlDurationMs');
  requireFiniteNonNegative(value.navigation.treatmentDurationMs, 'treatmentDurationMs');
}

export function validateDashboardSpec(value: unknown): void {
  if (!isRecord(value) || value.schemaVersion !== 5) {
    throw new Error('dashboard spec must use schemaVersion 5');
  }
  assertExactKeys(value, ['schemaVersion', 'status', 'provider', 'executable', 'title', 'telemetryContract', 'aggregationContract', 'queries', 'panels', 'alerts', 'disabledAlerts', 'rollback', 'knownPendingGaps', 'rollout'], 'dashboard spec');
  if (value.status !== 'validated-provider-neutral-spec-not-deployed' || value.provider !== 'neutral' || value.executable !== false) {
    throw new Error('dashboard must remain provider-neutral and not deployed');
  }
  if (!isRecord(value.telemetryContract)) throw new Error('complete telemetryContract is required');
  const contract = value.telemetryContract;
  assertExactKeys(contract, ['fixedEventNames', 'dimensions', 'classifications', 'measurements', 'browserVersionBucket', 'appVersionBucket', 'workerRelayContext', 'forbidden'], 'telemetryContract');
  if (
    !exactArray(contract.fixedEventNames, REQUIRED_EVENT_NAMES) ||
    !exactArray(contract.dimensions, REQUIRED_DIMENSIONS) ||
    !exactArray(contract.classifications, REQUIRED_CLASSIFICATIONS) ||
    !exactArray(contract.measurements, REQUIRED_MEASUREMENTS) ||
    !exactArray(contract.forbidden, REQUIRED_FORBIDDEN_FIELDS)
  ) {
    throw new Error('telemetryContract arrays must exactly match canonical schema');
  }
  const allowed = [...REQUIRED_DIMENSIONS, ...REQUIRED_CLASSIFICATIONS, ...REQUIRED_MEASUREMENTS, ...REQUIRED_EVENT_NAMES].map(normalizedKey);
  const forbidden = REQUIRED_FORBIDDEN_FIELDS.map(normalizedKey);
  if (forbidden.some((field) => allowed.includes(field))) {
    throw new Error('telemetryContract forbidden fields must be disjoint');
  }
  if (contract.browserVersionBucket !== 'major-only' || contract.appVersionBucket !== 'major.minor-release-only' || contract.workerRelayContext !== 'appVersion-and-rolloutCohort-unknown') {
    throw new Error('telemetry runtime bucketing contract is incomplete');
  }
  if (!exactObject(value.aggregationContract, AGGREGATION_CONTRACT)) {
    throw new Error('dashboard aggregation contract is not canonical');
  }
  if (
    !Array.isArray(value.queries) ||
    !Array.isArray(value.panels) ||
    !Array.isArray(value.alerts)
  ) {
    throw new Error('dashboard queries/panels/alerts missing');
  }
  assertUniqueInventory(value.queries, CANONICAL_QUERY_IDS, 'dashboard query');
  if (!exactObject(value.queries, CANONICAL_QUERIES)) {
    throw new Error('dashboard query selector/formula definitions are not canonical');
  }
  assertUniqueInventory(value.panels, CANONICAL_PANEL_IDS, 'dashboard panel');
  const queryIds = new Set<string>(CANONICAL_QUERY_IDS);
  for (const panel of value.panels) {
    if (!isRecord(panel)) throw new Error('invalid dashboard panel');
    assertExactKeys(panel, ['id', 'queryIds', 'statistics'], 'dashboard panel');
    if (
      !Array.isArray(panel.queryIds) ||
      panel.queryIds.some(
        (queryId) => typeof queryId !== 'string' || !queryIds.has(queryId)
      )
    ) {
      throw new Error(`dashboard panel references an unknown query: ${panel.id}`);
    }
  }
  if (!exactObject(value.panels, CANONICAL_PANELS)) {
    throw new Error('dashboard panel definitions are not canonical');
  }
  assertUniqueInventory(value.alerts, WP12_REQUIRED_ALERTS, 'dashboard alert');
  const alerts = new Map<string, Record<string, unknown>>();
  for (const alert of value.alerts) {
    if (!isRecord(alert)) throw new Error('invalid dashboard alert');
    assertExactKeys(alert, ['id', 'metric', 'windowMinutes', 'minimumEvents', 'warning', 'critical', 'unit', 'rollbackOnCritical'], 'dashboard alert');
    alerts.set(String(alert.id), alert);
  }
  for (const id of WP12_REQUIRED_ALERTS) {
    const alert = alerts.get(id);
    const canonical = ALERT_METRIC_UNITS[id];
    if (
      !alert || alert.metric !== canonical[0] || alert.unit !== canonical[1] ||
      !Number.isInteger(alert.windowMinutes) || Number(alert.windowMinutes) <= 0 ||
      !Number.isInteger(alert.minimumEvents) || Number(alert.minimumEvents) <= 0 ||
      typeof alert.warning !== 'number' || alert.warning <= 0 ||
      typeof alert.critical !== 'number' || alert.critical <= alert.warning ||
      alert.rollbackOnCritical !== true
    ) {
      throw new Error(`invalid canonical metric/unit/window/threshold for alert: ${id}`);
    }
  }
  if (!exactObject(value.alerts, CANONICAL_ALERTS)) {
    throw new Error('dashboard alert safety policy values are not canonical');
  }
  if (!exactObject(value.disabledAlerts, CANONICAL_DISABLED_ALERTS)) {
    throw new Error('dashboard disabled alert inventory is not canonical');
  }
  if (!isRecord(value.rollback) || !isRecord(value.rollout)) throw new Error('dashboard rollback/rollout missing');
  assertExactKeys(value.rollback, ['decision', 'target', 'targetValue', 'executor', 'executorConfiguredInRepository', 'liveMutationVerified', 'failureMode', 'activeSessionBehavior', 'maximumEmergencyEffectDelay', 'reenable', 'priorVersionRetention'], 'dashboard rollback');
  if (!isRecord(value.rollback.priorVersionRetention)) throw new Error('prior retention missing');
  assertExactKeys(value.rollback.priorVersionRetention, ['minimumReleases', 'minimumHours'], 'prior retention');
  if (!exactObject(value.rollback, CANONICAL_ROLLBACK)) {
    throw new Error('rollback safety policy values are not canonical');
  }
  if (!exactArray(value.knownPendingGaps, KNOWN_PENDING_GAPS)) throw new Error('known pending gaps are not canonical');
  assertExactKeys(value.rollout, ['currentExposurePercent', 'defaultProductionExposure', 'stages', 'promotionRequires'], 'dashboard rollout');
  const exposure = requireFiniteNonNegative(
    value.rollout.currentExposurePercent,
    'currentExposurePercent'
  );
  if (
    exposure > 100 ||
    exposure !== 0 ||
    value.rollout.defaultProductionExposure !== 'off' ||
    !Array.isArray(value.rollout.stages) ||
    !exactArray(value.rollout.promotionRequires, REQUIRED_PROMOTION_GATES)
  ) {
    throw new Error('candidate exposure, stages, or promotion gates are invalid');
  }
  assertUniqueInventory(
    value.rollout.stages,
    CANONICAL_ROLLOUT_STAGE_IDS,
    'rollout stage',
    'name'
  );
  for (const stage of value.rollout.stages) {
    if (!isRecord(stage)) throw new Error('invalid rollout stage');
    assertExactKeys(stage, ['name', 'maximumPercent', 'minimumSoakHours'], 'rollout stage');
    const maximumPercent = requireFiniteNonNegative(
      stage.maximumPercent,
      `rollout maximumPercent: ${stage.name}`
    );
    requireFiniteNonNegative(
      stage.minimumSoakHours,
      `rollout minimumSoakHours: ${stage.name}`
    );
    if (maximumPercent > 100) {
      throw new Error(`rollout maximumPercent exceeds 100: ${stage.name}`);
    }
  }
  if (!exactObject(value.rollout.stages, CANONICAL_ROLLOUT_STAGES)) {
    throw new Error('rollout stage safety policy values are not canonical');
  }
}

export function evaluateAlert(spec: Record<string, unknown>, alertId: string, observedValue: number, eventCount: number): AlertEvaluation {
  validateDashboardSpec(spec);
  requireFiniteNonNegative(observedValue, 'observedValue');
  requireFiniteNonNegative(eventCount, 'eventCount');
  const alert = (spec.alerts as Array<Record<string, unknown>>).find(({ id }) => id === alertId);
  if (!alert) throw new Error(`unknown alert: ${alertId}`);
  const evaluation = { observedValue, eventCount };
  if (eventCount < Number(alert.minimumEvents)) return { ...evaluation, state: 'insufficient-data' };
  if (observedValue >= Number(alert.critical)) return { ...evaluation, state: 'critical' };
  if (observedValue >= Number(alert.warning)) return { ...evaluation, state: 'warning' };
  return { ...evaluation, state: 'normal' };
}

export function recorderErrorRate(observations: readonly unknown[], eventName: string): { observedValue: number; eventCount: number } {
  let successes = 0;
  let errors = 0;
  for (const observation of observations) {
    if (!isRecord(observation)) continue;
    if (observation.name === 'graphql_cache.aggregate' && observation.aggregatedEventName === eventName && observation.outcome !== 'error' && typeof observation.count === 'number') {
      successes += observation.count;
    } else if (observation.name === eventName && observation.outcome === 'error' && observation.sampleRate === 1) {
      errors += 1;
    }
  }
  const eventCount = successes + errors;
  return { observedValue: eventCount === 0 ? 0 : errors / eventCount, eventCount };
}

export function rollbackDecision(spec: Record<string, unknown>, criticalAlertIds: string[]): {
  action: 'none' | 'trip-kill-switch'; target?: 'disable-browser-turso-cache'; targetValue?: true;
  mutationPerformed: false; requiresExternalExecutor: boolean; reenableRequiresHumanApproval: true;
} {
  validateDashboardSpec(spec);
  const known = new Set(WP12_REQUIRED_ALERTS);
  const tripped = criticalAlertIds.some((id) => known.has(id as never));
  return tripped
    ? { action: 'trip-kill-switch', target: 'disable-browser-turso-cache', targetValue: true, mutationPerformed: false, requiresExternalExecutor: true, reenableRequiresHumanApproval: true }
    : { action: 'none', mutationPerformed: false, requiresExternalExecutor: false, reenableRequiresHumanApproval: true };
}

const validEvidenceReference = (reference: string, repositoryRoot: string): boolean => {
  if (
    reference.startsWith('apps/') ||
    reference.startsWith('crates/') ||
    reference.startsWith('packages/')
  ) {
    const isTestOrMeasurement =
      /(?:^|\/)(?:tests?|browser-test)(?:\/|\.)/.test(reference) ||
      /\.(?:test|e2e)\.[cm]?[jt]sx?$/.test(reference) ||
      /\/[^/]*test\.rs$/.test(reference) ||
      /\/measurements\/.+\.json$/.test(reference);
    return (
      isTestOrMeasurement && existsSync(resolve(repositoryRoot, reference))
    );
  }
  return [
    'cargo test -p cache-core -p cache-sqlite -p cache-turso -p turso-opfs',
    'cargo check --target wasm32-unknown-unknown -p cache-turso -p turso-opfs -p cache-wasm --all-targets',
    'bun run test',
    'bun type-check',
    'just build-dev',
    'just report-cache-wp12',
  ].includes(reference);
};

export function validateTestMatrix(value: unknown, repositoryRoot = REPOSITORY_ROOT): number {
  if (!isRecord(value) || value.schemaVersion !== 4) throw new Error('Section 10 matrix schema is invalid');
  assertExactKeys(value, ['schemaVersion', 'source', 'status', 'sections'], 'test matrix');
  if (value.source !== 'graphql-cache-turso-worker-migration-plan.md#10-required-test-matrix' || value.status !== 'inventory-validated-with-pending-real-browser-gates' || !Array.isArray(value.sections)) {
    throw new Error('Section 10 test matrix inventory is invalid');
  }
  const canonicalSectionIds = ['10.1', '10.2', '10.3', '10.4'];
  assertUniqueInventory(value.sections, canonicalSectionIds, 'matrix section');
  const sections = new Map<string, Record<string, unknown>>();
  for (const section of value.sections) {
    if (!isRecord(section)) throw new Error('invalid matrix section');
    const expectedKeys = section.id === '10.3' ? ['id', 'title', 'targets', 'cases'] : ['id', 'title', 'cases'];
    assertExactKeys(section, expectedKeys, 'matrix section');
    const sectionId = String(section.id) as keyof typeof MATRIX_SECTION_TITLES;
    if (section.title !== MATRIX_SECTION_TITLES[sectionId]) {
      throw new Error(`matrix section title is not canonical: ${sectionId}`);
    }
    sections.set(sectionId, section);
  }
  let pendingCoverageCount = 0;
  const requirementEvidenceInventory: Array<Record<string, unknown>> = [];
  for (const [sectionId, ids] of Object.entries(MATRIX_CASE_IDS)) {
    const section = sections.get(sectionId);
    if (!section || !Array.isArray(section.cases)) throw new Error(`Section ${sectionId} missing`);
    if (sectionId === '10.3' && !exactArray(section.targets, BROWSER_TARGETS)) throw new Error('real-browser targets are not canonical');
    assertUniqueInventory(section.cases, ids, `matrix case ${sectionId}`);
    const cases = new Map<string, Record<string, unknown>>();
    for (const candidate of section.cases) {
      if (!isRecord(candidate)) throw new Error('invalid matrix case');
      assertExactKeys(candidate, sectionId === '10.3' ? ['id', 'requirement', 'coverage', 'evidence'] : ['id', 'requirement', 'status', 'evidence'], 'matrix case');
      cases.set(String(candidate.id), candidate);
    }
    for (const id of ids) {
      const candidate = cases.get(id);
      if (!candidate || !Array.isArray(candidate.evidence)) throw new Error(`matrix case ${id} evidence invalid`);
      requirementEvidenceInventory.push({
        id,
        requirement: candidate.requirement,
        evidence: candidate.evidence,
      });
      let verified = false;
      if (sectionId === '10.3') {
        if (!isRecord(candidate.coverage) || !exactObject(candidate.coverage, MATRIX_COVERAGE[id])) throw new Error(`matrix coverage/status floor violated: ${id}`);
        const expectedTargets = id === '10.3.12' ? NATIVE_TARGETS : BROWSER_TARGETS;
        if (!exactArray(Object.keys(candidate.coverage), expectedTargets)) throw new Error(`matrix targets invalid: ${id}`);
        const coverage = Object.values(candidate.coverage).map(String);
        pendingCoverageCount += coverage.filter((status) => status.startsWith('pending-')).length;
        verified = coverage.some((status) => status.startsWith('verified-'));
      } else {
        if (candidate.status !== MATRIX_STATUS[id]) throw new Error(`matrix status floor violated: ${id}`);
        const status = String(candidate.status);
        if (status.includes('pending')) pendingCoverageCount += 1;
        verified = status.startsWith('verified-');
      }
      if (verified && (candidate.evidence.length === 0 || candidate.evidence.some((reference) => typeof reference !== 'string' || !validEvidenceReference(reference, repositoryRoot)))) {
        throw new Error(`verified matrix case has invalid evidence reference: ${id}`);
      }
    }
  }
  const requirementEvidenceDigest = createHash('sha256')
    .update(JSON.stringify(requirementEvidenceInventory))
    .digest('hex');
  if (
    requirementEvidenceDigest !==
    CANONICAL_MATRIX_REQUIREMENT_EVIDENCE_SHA256
  ) {
    throw new Error('matrix requirement/evidence mappings are not canonical');
  }
  if (pendingCoverageCount === 0) throw new Error('matrix must retain pending gates');
  return pendingCoverageCount;
}

export function buildWp12Report(options: {
  evidence: Wp12BrowserEvidence[];
  dashboard: Record<string, unknown>;
  matrix: Record<string, unknown>;
  expectedRevisionChangeId: string;
  expectedSourceDigest: string;
  expectedWasmSha256: string;
  executableSha256ByPath: Readonly<Record<string, string>>;
  now: Date;
  repositoryRoot?: string;
}): Wp12Report {
  validateDashboardSpec(options.dashboard);
  const pendingCoverageCount = validateTestMatrix(options.matrix, options.repositoryRoot);
  for (const entry of options.evidence) {
    validateWp12BrowserEvidence(entry, {
      now: options.now,
      expectedRevisionChangeId: options.expectedRevisionChangeId,
      expectedSourceDigest: options.expectedSourceDigest,
      expectedWasmSha256: options.expectedWasmSha256,
      executableSha256ByPath: options.executableSha256ByPath,
    });
  }
  const families = new Set(options.evidence.map(({ browser }) => browser.family));
  if (!families.has('chromium') || !families.has('firefox')) throw new Error('production Chromium and Firefox evidence required');
  const measuredTimes = options.evidence.map(({ measuredAt }) => Date.parse(measuredAt));
  if (Math.max(...measuredTimes) - Math.min(...measuredTimes) > 60 * 60 * 1_000) throw new Error('browser evidence must come from one bounded run');
  return {
    schemaVersion: 5,
    measuredRevisionChangeId: options.expectedRevisionChangeId,
    measuredSourceDigest: options.expectedSourceDigest,
    status: 'candidate-local-subset-pass-exposure-blocked',
    exposurePercent: 0,
    productionDefault: 'off',
    telemetryContract: options.dashboard.telemetryContract as Record<string, unknown>,
    testMatrix: { path: 'ops/graphql-cache-wp12-test-matrix.json', status: 'inventory-validated-with-pending-real-browser-gates', pendingCoverageCount },
    browsers: options.evidence.toSorted((a, b) => a.project.localeCompare(b.project)),
    pending: [
      'required Section 10 real-browser matrix entries listed in testMatrix',
      'latest stable macOS Safari external runner',
      'live S3/CloudFront delivery verification',
      'product-owner numeric budget acceptance',
      'active DedicatedWorker JS/native memory telemetry unavailable without cross-origin isolation and cross-browser worker API support',
      'external PostHog rollback executor and provider dashboard deployment',
    ],
    claims: {
      allLocalGatesPassed: false,
      productionWrapperDefaultOffBrowserVerified: true,
      realStandbyTabCloseVerified: true,
      realLogoutResetVerified: true,
      posthogTreatmentOverrideVerified: true,
      nextNavigationEmergencyDisableVerified: true,
      posthogNetworkRequestsObserved: false,
      admittedMutatingRpcTerminationVerified: true,
      incompatibleNamespaceRecoveryVerified: true,
      corruptQueuePayloadRecoveryVerified: true,
      queueDiagnosticsTelemetryVerified: true,
      initializationRecoveryOutcomeTelemetryVerified: true,
      totalWorkerMemoryTelemetryImplemented: false,
      safariVerified: false,
      liveS3CloudFrontVerified: false,
      posthogMutationPerformed: false,
      dashboardDeployed: false,
    },
  };
}

function captureMeasuredRevisionChangeId(): string {
  return execFileSync('jj', ['log', '-r', 'latest(ancestors(@) & ~empty())', '--no-graph', '-T', 'change_id'], { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  const measuredRevisionChangeId = captureMeasuredRevisionChangeId();
  const measuredSourceDigest = await computeMeasuredSourceDigest();
  const [dashboard, matrix, wp11] = await Promise.all(
    ['ops/graphql-cache-wp12-dashboard.json', 'ops/graphql-cache-wp12-test-matrix.json', 'measurements/cache-wasm-wp11.json'].map(async (path) => JSON.parse(await readFile(resolve(WEB_ROOT, path), 'utf8')))
  );
  const wp11PackageHash = wp11?.package?.wasmSha256;
  if (typeof wp11PackageHash !== 'string' || wp11PackageHash !== wp11?.dist?.cacheWasmSha256) throw new Error('WP-11 package/dist WASM hashes inconsistent');
  const evidence = await Promise.all(
    ['cache-wasm-wp12-chromium-production.json', 'cache-wasm-wp12-firefox-production.json'].map(async (path) => JSON.parse(await readFile(resolve(WEB_ROOT, 'measurements/generated', path), 'utf8')) as Wp12BrowserEvidence)
  );
  const executablePaths = [...new Set(evidence.map(({ runner }) => runner.executablePath))];
  const executableSha256ByPath = Object.fromEntries(
    await Promise.all(executablePaths.map(async (path) => [path, await sha256File(path)] as const))
  );
  const report = buildWp12Report({
    evidence,
    dashboard,
    matrix,
    expectedRevisionChangeId: measuredRevisionChangeId,
    expectedSourceDigest: measuredSourceDigest,
    expectedWasmSha256: wp11PackageHash,
    executableSha256ByPath,
    now: new Date(),
  });
  await writeFile(resolve(WEB_ROOT, 'measurements/cache-wasm-wp12.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`WP12_REPORT=${JSON.stringify(report)}`);
}

if (import.meta.main) await main();
