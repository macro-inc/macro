import { describe, expect, it } from 'vitest';
import {
  type Baseline,
  baselineOf,
  GATED_COUNTS,
  type GatedCounts,
  type GatedRun,
  gateFailures,
} from './gate';

function counts(overrides: Partial<GatedCounts> = {}): GatedCounts {
  const zero = Object.fromEntries(
    GATED_COUNTS.map((count) => [count, 0])
  ) as GatedCounts;
  return { ...zero, ...overrides };
}

function runs(atN: GatedCounts, at2N: GatedCounts = atN): GatedRun[] {
  return [
    { channels: 3_500, scenarios: { appShell: atN } },
    { channels: 7_000, scenarios: { appShell: at2N } },
  ];
}

describe('the Chat cache harness gate', () => {
  it('passes a run equal to its baseline', () => {
    const measured = runs(counts({ 'sql.rows': 1_000 }));
    expect(gateFailures(measured, baselineOf(measured))).toEqual([]);
  });

  it('fails more work and less work alike, outside the band', () => {
    const baseline = baselineOf(runs(counts({ 'sql.rows': 1_000 })));
    const within = runs(counts({ 'sql.rows': 1_050 }));
    const more = runs(counts({ 'sql.rows': 1_100 }));
    const less = runs(counts({ 'sql.rows': 900 }));
    expect(gateFailures(within, baseline)).toEqual([]);
    expect(gateFailures(more, baseline)).toEqual([
      'appShell at 3500: sql.rows 1100, baseline 1000 (+10%, band ±50)',
      'appShell at 7000: sql.rows 1100, baseline 1000 (+10%, band ±50)',
    ]);
    expect(gateFailures(less, baseline)).toHaveLength(2);
  });

  it('lets a count near zero move by the floor', () => {
    const baseline = baselineOf(runs(counts({ 'engine.calls': 2 })));
    expect(gateFailures(runs(counts({ 'engine.calls': 7 })), baseline)).toEqual(
      []
    );
    expect(
      gateFailures(runs(counts({ 'engine.calls': 8 })), baseline)
    ).toHaveLength(2);
  });

  it('fails a count that more than doubles with the account', () => {
    const measured = runs(
      counts({ 'sql.rows': 1_000 }),
      counts({ 'sql.rows': 2_300 })
    );
    expect(gateFailures(measured, baselineOf(measured))).toEqual([
      'appShell: sql.rows grew from 1000 at 3500 to 2300 at 7000, over 2.2×',
    ]);
  });

  it('holds a visible-window cap whatever the baseline says', () => {
    const write = counts({ 'engine.recordsOut': 1 });
    const measured: GatedRun[] = [
      { channels: 3_500, scenarios: { unrelatedWrite: write } },
      { channels: 7_000, scenarios: { unrelatedWrite: write } },
    ];
    expect(gateFailures(measured, baselineOf(measured))).toEqual([
      'unrelatedWrite at 3500: engine.recordsOut 1 is over its visible-window cap 0',
      'unrelatedWrite at 7000: engine.recordsOut 1 is over its visible-window cap 0',
    ]);
  });

  it('fails a run missing a size, a scenario or a count of its baseline', () => {
    const measured = runs(counts());
    const baseline = baselineOf(measured);
    expect(gateFailures(measured.slice(0, 1), baseline)).toEqual([
      'the growth check needs a run at N and at 2N',
    ]);
    const dropped: GatedRun[] = measured.map((run) => ({
      channels: run.channels,
      scenarios: {},
    }));
    expect(gateFailures(dropped, baseline)).toEqual([
      'appShell at 3500: no longer measured',
      'appShell at 7000: no longer measured',
    ]);
    const older: Baseline = {
      ...baseline,
      sizes: { ...baseline.sizes, '3500': { appShell: {} } },
    };
    expect(gateFailures(measured, older)).toHaveLength(GATED_COUNTS.length);
  });
});
