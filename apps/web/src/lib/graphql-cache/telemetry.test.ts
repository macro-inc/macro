import { describe, expect, it } from 'vitest';
import {
  browserCacheTelemetryContext,
  type CacheTelemetryEnvelope,
  type CacheTelemetryObservation,
  CacheTelemetryRecorder,
  CacheTelemetryReporter,
  classifyCacheError,
  isCacheTelemetryObservation,
  isolateCacheTelemetry,
  operationCategoryForRequest,
  resetReasonForError,
} from './telemetry';

describe('cache telemetry privacy contract', () => {
  it('exports only fixed names, classifications, measurements, and allowlisted dimensions', () => {
    const events: CacheTelemetryEnvelope[] = [];
    const reporter = new CacheTelemetryReporter(
      browserCacheTelemetryContext(
        'treatment',
        'Mozilla/5.0 Firefox/151.0 secret-user-fragment',
        '0.1.0+abc123'
      ),
      { emit: (event) => events.push(event) }
    );
    const hostile = {
      name: 'graphql_cache.host_request',
      operationCategory: 'read',
      outcome: 'hit',
      durationMs: 4,
      scope: 'scope-secret',
      entityId: 'doc-secret',
      userId: 'user-secret',
      query: 'query Secret { document(id: "doc-secret") { id } }',
      variables: { token: 'secret-token' },
      result: { private: true },
    } as unknown as CacheTelemetryObservation;

    reporter.emit(hostile);

    expect(events).toEqual([
      {
        browserFamily: 'firefox',
        browserVersion: '151',
        appVersion: '0.1',
        backend: 'turso-wasm-opfs',
        rolloutCohort: 'treatment',
        name: 'graphql_cache.host_request',
        operationCategory: 'read',
        outcome: 'hit',
        durationMs: 4,
      },
    ]);
    const serialized = JSON.stringify(events);
    for (const forbidden of [
      'scope-secret',
      'doc-secret',
      'user-secret',
      'query Secret',
      'secret-token',
      'private',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('exports queue diagnostics and open outcomes without IDs or payloads', () => {
    const events: CacheTelemetryEnvelope[] = [];
    const reporter = new CacheTelemetryReporter(
      browserCacheTelemetryContext('treatment'),
      { emit: (event) => events.push(event) }
    );
    reporter.emit({
      name: 'graphql_cache.queue_diagnostics',
      operationCategory: 'queue',
      outcome: 'success',
      errorCode: 'none',
      openOutcome: 'reset-corrupt',
      queueDiagnosticsAvailability: 'available',
      revisionCategory: 'authoritative-write',
      resetAttempt: 'wipe-before-open',
      queueDepth: 3,
      oldestAgeMs: 42,
      scope: 'private-scope',
      mutationId: 'private-mutation',
      query: 'mutation Private { private }',
    } as unknown as CacheTelemetryObservation);

    expect(events).toEqual([
      expect.objectContaining({
        name: 'graphql_cache.queue_diagnostics',
        openOutcome: 'reset-corrupt',
        queueDiagnosticsAvailability: 'available',
        revisionCategory: 'authoritative-write',
        resetAttempt: 'wipe-before-open',
        queueDepth: 3,
        oldestAgeMs: 42,
      }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /private-scope|private-mutation|mutation Private/
    );
  });

  it('rejects relay payloads with unknown fields or ad-hoc names', () => {
    expect(
      isCacheTelemetryObservation({
        name: 'graphql_cache.read',
        operationCategory: 'read',
        outcome: 'miss',
      })
    ).toBe(true);
    expect(
      isCacheTelemetryObservation({
        name: 'graphql_cache.read',
        operationCategory: 'read',
        query: '{ secret }',
      })
    ).toBe(false);
    expect(
      isCacheTelemetryObservation({
        name: 'graphql_cache.dynamic.secret',
        operationCategory: 'read',
      })
    ).toBe(false);
  });

  it('uses a payload-free exhaustive error taxonomy', () => {
    expect(classifyCacheError(new Error('OPFS quota full: doc-123'))).toBe(
      'opfs-quota'
    );
    expect(classifyCacheError(new Error('owner epoch 3 was lost'))).toBe(
      'owner-lost'
    );
    expect(classifyCacheError(new Error('corrupt postcard for User:1'))).toBe(
      'integrity'
    );
    expect(resetReasonForError(new Error('namespace mismatch: private'))).toBe(
      'namespace-mismatch'
    );
    expect(classifyCacheError({ private: 'not stringified' })).toBe('unknown');
  });

  it('maps every request kind to an allowlisted operation category', () => {
    const cases = {
      init: 'initialization',
      read: 'read',
      'read-records-by-keys': 'read',
      search: 'read',
      write: 'write',
      'enqueue-optimistic-mutation': 'transaction',
      'inspect-query-variants': 'inspection',
      'inspect-query': 'inspection',
      'claim-next-mutation': 'transaction',
      'defer-optimistic-write': 'transaction',
      'commit-optimistic-write': 'transaction',
      'rollback-optimistic-write': 'transaction',
      invalidate: 'invalidation',
      'delete-records': 'invalidation',
      teardown: 'lifecycle',
      clear: 'lifecycle',
    } as const;

    for (const [kind, expected] of Object.entries(cases)) {
      expect(operationCategoryForRequest({ kind } as never)).toBe(expected);
    }
  });
});

describe('cache telemetry sampling and failure isolation', () => {
  it('uses weighted aggregates, independent event sampling, and unsampled errors', () => {
    const observations: CacheTelemetryObservation[] = [];
    const recorder = new CacheTelemetryRecorder(
      { emit: (event) => observations.push(event) },
      10,
      100
    );
    recorder.record({
      name: 'graphql_cache.read',
      operationCategory: 'read',
      outcome: 'hit',
      durationMs: 10,
      count: 2,
    });
    recorder.record({
      name: 'graphql_cache.read',
      operationCategory: 'read',
      outcome: 'hit',
      durationMs: 20,
      count: 3,
    });
    for (let index = 0; index < 10; index++) {
      for (const outcome of ['hit', 'miss'] as const) {
        recorder.record({
          name: 'graphql_cache.read',
          operationCategory: 'read',
          outcome,
          durationMs: index,
        });
      }
    }
    recorder.record({
      name: 'graphql_cache.transaction',
      operationCategory: 'transaction',
      outcome: 'error',
      errorCode: 'opfs-io',
    });
    recorder.flush();

    const hitAggregate = observations.find(
      (event) =>
        event.name === 'graphql_cache.aggregate' && event.outcome === 'hit'
    );
    expect(hitAggregate).toMatchObject({
      aggregatedEventName: 'graphql_cache.read',
      count: 15,
      durationMs: 8.333333333333334,
      sampleRate: 1,
    });
    expect(
      observations.filter(
        (event) =>
          event.name === 'graphql_cache.read' && event.sampleRate === 10
      )
    ).toHaveLength(2);
    expect(
      observations.find((event) => event.name === 'graphql_cache.transaction')
    ).toMatchObject({ outcome: 'error', sampleRate: 1 });
    expect(
      observations.filter(
        (event) =>
          event.name === 'graphql_cache.aggregate' &&
          event.aggregatedEventName === 'graphql_cache.transaction'
      )
    ).toEqual([]);
  });

  it('flushes matching pending successes before each raw error', () => {
    const observations: CacheTelemetryObservation[] = [];
    const recorder = new CacheTelemetryRecorder({
      emit: (event) => observations.push(event),
    });
    for (let index = 0; index < 149; index++) {
      recorder.record({
        name: 'graphql_cache.transaction',
        operationCategory: 'transaction',
        outcome: 'success',
      });
    }
    for (let index = 0; index < 2; index++) {
      recorder.record({
        name: 'graphql_cache.transaction',
        operationCategory: 'transaction',
        outcome: 'error',
        errorCode: 'opfs-io',
      });
    }

    const aggregates = observations.filter(
      (event) =>
        event.name === 'graphql_cache.aggregate' &&
        event.aggregatedEventName === 'graphql_cache.transaction'
    );
    expect(
      aggregates.reduce((total, event) => total + (event.count ?? 0), 0)
    ).toBe(149);
    const firstErrorIndex = observations.findIndex(
      (event) =>
        event.name === 'graphql_cache.transaction' && event.outcome === 'error'
    );
    expect(observations[firstErrorIndex - 1]).toMatchObject({
      name: 'graphql_cache.aggregate',
      count: 49,
    });
    expect(
      observations.filter(
        (event) =>
          event.name === 'graphql_cache.transaction' &&
          event.outcome === 'error' &&
          event.sampleRate === 1
      )
    ).toHaveLength(2);
  });

  it('never lets a throwing sink or injected recorder change the caller outcome', () => {
    const recorder = new CacheTelemetryRecorder({
      emit: () => {
        throw new Error('exporter secret failure');
      },
    });
    const reporter = new CacheTelemetryReporter(
      browserCacheTelemetryContext('unknown'),
      {
        emit: () => {
          throw new Error('otel down');
        },
      }
    );

    expect(() =>
      recorder.record({
        name: 'graphql_cache.db_ready',
        operationCategory: 'initialization',
        outcome: 'success',
      })
    ).not.toThrow();
    expect(() =>
      reporter.emit({
        name: 'graphql_cache.reset_wipe',
        operationCategory: 'storage',
        outcome: 'error',
      })
    ).not.toThrow();
    expect(() => recorder.flush()).not.toThrow();

    const injected = isolateCacheTelemetry({
      record: () => {
        throw new Error('injected record failed');
      },
      flush: () => {
        throw new Error('injected flush failed');
      },
    });
    expect(() =>
      injected.record({
        name: 'graphql_cache.owner',
        operationCategory: 'lifecycle',
      })
    ).not.toThrow();
    expect(() => injected.flush()).not.toThrow();
  });

  it('bounds invalid numbers and unsafe runtime dimensions', () => {
    const events: CacheTelemetryEnvelope[] = [];
    const reporter = new CacheTelemetryReporter(
      browserCacheTelemetryContext(
        'override',
        'Mozilla/5.0 Chrome/145.0.7632.6',
        'user@example.com/private'
      ),
      { emit: (event) => events.push(event) }
    );
    reporter.emit({
      name: 'graphql_cache.origin_storage_pressure',
      operationCategory: 'storage',
      usageBytes: -1,
      quotaBytes: Number.POSITIVE_INFINITY,
      ratio: 7,
    });

    expect(events[0]).toMatchObject({
      browserFamily: 'chromium',
      browserVersion: '145',
      appVersion: 'unknown',
      ratio: 1,
    });
    expect(events[0]).not.toHaveProperty('usageBytes');
    expect(events[0]).not.toHaveProperty('quotaBytes');

    const hostileContextEvents: CacheTelemetryEnvelope[] = [];
    new CacheTelemetryReporter(
      {
        browserFamily: 'private-user' as never,
        browserVersion: '151.0 user-secret',
        appVersion: 'private@example.com',
        backend: 'private-backend' as never,
        rolloutCohort: 'private-cohort' as never,
      },
      { emit: (event) => hostileContextEvents.push(event) }
    ).emit({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
    });
    expect(hostileContextEvents[0]).toMatchObject({
      browserFamily: 'other',
      browserVersion: 'unknown',
      appVersion: 'unknown',
      backend: 'turso-wasm-opfs',
      rolloutCohort: 'unknown',
    });
    expect(JSON.stringify(hostileContextEvents)).not.toContain('private');
  });
});
