import { beforeEach, describe, expect, it, vi } from 'vitest';

const span = vi.hoisted(() => ({ setAttr: vi.fn(), end: vi.fn() }));
const anonymousSpan = vi.hoisted(() => vi.fn(() => span));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { anonymousSpan },
}));

import { createOtelCacheTelemetrySink } from './telemetry-otel';

describe('cache OpenTelemetry sink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses anonymous fixed-name spans and only schema attributes', () => {
    createOtelCacheTelemetrySink().emit({
      browserFamily: 'firefox',
      browserVersion: '151',
      appVersion: '0.1',
      backend: 'turso-wasm-opfs',
      rolloutCohort: 'treatment',
      name: 'graphql_cache.transaction',
      operationCategory: 'transaction',
      outcome: 'error',
      errorCode: 'opfs-quota',
      openOutcome: 'reset-corrupt',
      queueDiagnosticsAvailability: 'available',
      revisionCategory: 'optimistic-commit',
      resetAttempt: 'wipe-before-open',
      queueDepth: 4,
      oldestAgeMs: 25,
      durationMs: 12,
    });

    expect(anonymousSpan).toHaveBeenCalledWith('graphql_cache.transaction');
    expect(Object.fromEntries(span.setAttr.mock.calls)).toEqual({
      'cache.browser_family': 'firefox',
      'cache.browser_version': '151',
      'cache.app_version': '0.1',
      'cache.backend': 'turso-wasm-opfs',
      'cache.rollout_cohort': 'treatment',
      'cache.operation_category': 'transaction',
      'cache.outcome': 'error',
      'cache.error_code': 'opfs-quota',
      'cache.open_outcome': 'reset-corrupt',
      'cache.queue_diagnostics_availability': 'available',
      'cache.revision_category': 'optimistic-commit',
      'cache.reset_attempt': 'wipe-before-open',
      'cache.duration_ms': 12,
      'cache.queue_depth': 4,
      'cache.oldest_age_ms': 25,
    });
    expect(span.end).toHaveBeenCalledOnce();
  });

  it('isolates Telemetry failures', () => {
    anonymousSpan.mockImplementationOnce(() => {
      throw new Error('provider unavailable');
    });
    expect(() =>
      createOtelCacheTelemetrySink().emit({
        browserFamily: 'other',
        browserVersion: 'unknown',
        appVersion: 'unknown',
        backend: 'turso-wasm-opfs',
        rolloutCohort: 'unknown',
        name: 'graphql_cache.db_ready',
        operationCategory: 'initialization',
      })
    ).not.toThrow();
  });
});
