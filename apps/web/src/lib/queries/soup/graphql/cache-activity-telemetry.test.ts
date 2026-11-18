import { expect, it, vi } from 'vitest';
import { createSoupCacheTelemetry } from './cache-activity-telemetry';

it('bounds exports by time across all active views and preserves totals', () => {
  let time = 0;
  const report = vi.fn();
  const telemetry = createSoupCacheTelemetry({ now: () => time, report });
  for (let i = 0; i < 10_000; i++) {
    telemetry.record('predicate', { durationMs: 2, rows: 20, patches: 1 });
    telemetry.record('local', { durationMs: 3, retries: 1 });
  }
  expect(report).not.toHaveBeenCalled();
  time = 300_000;
  telemetry.record('local', { error: true, durationMs: 5 });
  expect(report).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      'cache.summary_interval_ms': 300_000,
      'cache.predicate.count': 10_000,
      'cache.predicate.duration_total_ms': 20_000,
      'cache.predicate.duration_max_ms': 2,
      'cache.predicate.rows_total': 200_000,
      'cache.predicate.patches': 10_000,
      'cache.local.count': 10_001,
      'cache.local.duration_total_ms': 30_005,
      'cache.local.duration_max_ms': 5,
      'cache.local.errors': 1,
      'cache.local.retries': 10_000,
    })
  );
  telemetry.record('predicate', { discarded: true });
  expect(report).toHaveBeenCalledTimes(1);
  time = 600_000;
  telemetry.record('generation');
  expect(report).toHaveBeenLastCalledWith(
    expect.objectContaining({
      'cache.predicate.count': 1,
      'cache.predicate.discarded': 1,
    })
  );
  expect(report.mock.calls[1][0]).not.toHaveProperty('cache.local.count');
});

it('isolates exporter failure and retries retained counters at the next interval', () => {
  let time = 0;
  const report = vi.fn().mockImplementationOnce(() => {
    throw new Error('offline exporter');
  });
  const telemetry = createSoupCacheTelemetry({ now: () => time, report });
  time = 300_000;
  expect(() => telemetry.record('local', { rows: 20 })).not.toThrow();
  for (let i = 0; i < 100; i++) telemetry.record('local', { rows: 20 });
  expect(report).toHaveBeenCalledTimes(1);
  time = 600_000;
  telemetry.record('local', { rows: 20 });
  expect(report).toHaveBeenLastCalledWith(
    expect.objectContaining({
      'cache.summary_interval_ms': 600_000,
      'cache.local.count': 102,
      'cache.local.rows_total': 2_040,
    })
  );
});
