import { beforeEach, describe, expect, it, vi } from 'vitest';

const span = vi.hoisted(() => ({
  setAttr: vi.fn(),
  end: vi.fn(),
  run: vi.fn((callback: () => void) => callback()),
}));
const anonymousSpan = vi.hoisted(() => vi.fn(() => span));
const warn = vi.hoisted(() => vi.fn());

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { anonymousSpan, warn },
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

  it('exports a slow execution as a correlated warning without SQL or parameters', () => {
    createOtelCacheTelemetrySink().emit({
      browserFamily: 'firefox',
      browserVersion: '151',
      appVersion: '0.1',
      backend: 'turso-wasm-opfs',
      rolloutCohort: 'unknown',
      name: 'graphql_cache.slow_query',
      operationCategory: 'storage',
      queryFingerprint: 'a430d84680aabd0b',
      durationMs: 201,
      outcome: 'success',
    });

    expect(anonymousSpan).toHaveBeenCalledWith('graphql_cache.slow_query');
    expect(span.run).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledExactlyOnceWith('graphql_cache.slow_query', {
      'db.system.name': 'sqlite',
      'db.query.fingerprint': 'a430d84680aabd0b',
      'cache.backend': 'turso-wasm-opfs',
      'cache.duration_ms': 201,
      'cache.outcome': 'success',
      'cache.slow_query_threshold_ms': 200,
    });
    expect(span.end).toHaveBeenCalledOnce();
  });

  it('ends the slow-query span even if logging throws', () => {
    warn.mockImplementationOnce(() => {
      throw new Error('logger unavailable');
    });
    expect(() =>
      createOtelCacheTelemetrySink().emit({
        browserFamily: 'other',
        browserVersion: 'unknown',
        appVersion: 'unknown',
        backend: 'turso-wasm-opfs',
        rolloutCohort: 'unknown',
        name: 'graphql_cache.slow_query',
        operationCategory: 'storage',
        durationMs: 201,
        outcome: 'error',
      })
    ).not.toThrow();
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
