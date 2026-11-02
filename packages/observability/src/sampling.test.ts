import { expect, test, vi } from 'vitest';
import { keepsClass } from './sampling';
import { Telemetry } from './telemetry';

test('a key makes the same decision for a class every time', () => {
  expect(keepsClass('user-1:2900', 'perf', 0.05)).toBe(
    keepsClass('user-1:2900', 'perf', 0.05)
  );
  expect(keepsClass('user-1:2900', 'perf', 0)).toBe(false);
  expect(keepsClass('user-1:2900', 'perf', 1)).toBe(true);
});

test('a rate keeps that share of keys, independently for each class', () => {
  const keys = Array.from({ length: 20_000 }, (_, index) => `user-${index}`);
  const perf = keys.filter((key) => keepsClass(key, 'perf', 0.05));
  expect(perf.length / keys.length).toBeGreaterThan(0.045);
  expect(perf.length / keys.length).toBeLessThan(0.055);
  const both = keys.filter(
    (key) => keepsClass(key, 'perf', 0.5) && keepsClass(key, 'always', 0.5)
  );
  expect(both.length / keys.length).toBeGreaterThan(0.23);
  expect(both.length / keys.length).toBeLessThan(0.27);
});

test('the rotating salt in a key moves a user between cohorts', () => {
  const keys = Array.from({ length: 2_000 }, (_, index) => `user-${index}`);
  const thisWeek = keys.filter((key) =>
    keepsClass(`${key}:2900`, 'perf', 0.05)
  );
  const nextWeek = thisWeek.filter((key) =>
    keepsClass(`${key}:2901`, 'perf', 0.05)
  );
  expect(nextWeek.length).toBeLessThan(thisWeek.length / 2);
});

test('classes are decided from the sampling key read at enablement', async () => {
  let enable: (enabled: boolean) => void = () => {};
  const enabled = new Promise<boolean>((resolve) => {
    enable = resolve;
  });
  const samplingKey = vi.fn(() => 'user-1:2900');
  const initialization = Telemetry.init({
    serviceName: 'test',
    environment: 'test',
    enabled: () => enabled,
    sampling: { always: 1, never: 0 },
    samplingKey,
  });
  await Promise.resolve();
  expect(samplingKey).not.toHaveBeenCalled();
  expect(Telemetry.config.sampled('always')).toBe(false);
  enable(true);
  await initialization;
  expect(samplingKey).toHaveBeenCalledOnce();
  expect(Telemetry.config.sampled('always')).toBe(true);
  expect(Telemetry.config.sampled('never')).toBe(false);
});
