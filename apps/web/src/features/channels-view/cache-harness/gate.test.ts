import { describe, expect, it } from 'vitest';
import {
  type Baseline,
  baselineOf,
  GATED_COUNTS,
  type GatedCounts,
  type GatedRun,
  gateFailures,
  SCENARIOS,
  type ScenarioName,
} from './gate';

/** Enough work that every scenario shows it ran, and nothing near a cap. */
const RAN: Partial<GatedCounts> = {
  'engine.calls': 1,
  'sql.statements': 1,
  'rows.rendered': 1,
};

function zero(): GatedCounts {
  return Object.fromEntries(
    GATED_COUNTS.map((count) => [count, 0])
  ) as GatedCounts;
}

function counts(overrides: Partial<GatedCounts> = {}): GatedCounts {
  return { ...zero(), ...RAN, ...overrides };
}

/** Every scenario at `counts()`, with `appShell` and any of `others` as given. */
function run(
  channels: number,
  appShell: GatedCounts = counts(),
  others: Partial<Record<ScenarioName, GatedCounts>> = {}
): GatedRun {
  const all = Object.fromEntries(SCENARIOS.map((name) => [name, counts()]));
  return { channels, scenarios: { ...all, appShell, ...others } };
}

function runs(atN: GatedCounts, at2N: GatedCounts = atN): GatedRun[] {
  return [run(3_500, atN), run(7_000, at2N)];
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
    const write = { unrelatedWrite: counts({ 'engine.recordsOut': 1 }) };
    const measured = [run(3_500, counts(), write), run(7_000, counts(), write)];
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
    const dropped: GatedRun[] = measured.map((each) => {
      const { collapse: _, ...rest } = each.scenarios;
      return { channels: each.channels, scenarios: rest };
    });
    expect(gateFailures(dropped, baseline)).toEqual([
      'collapse at 3500: not measured',
      'collapse at 7000: not measured',
      'collapse at 3500: no longer measured',
      'collapse at 7000: no longer measured',
    ]);
    const older: Baseline = {
      ...baseline,
      sizes: {
        ...baseline.sizes,
        '3500': { ...baseline.sizes['3500'], appShell: {} },
      },
    };
    expect(gateFailures(measured, older)).toHaveLength(GATED_COUNTS.length);
  });

  it('fails a run that measured nothing, even against a baseline of it', () => {
    const empty: GatedRun[] = [
      { channels: 3_500, scenarios: {} },
      { channels: 7_000, scenarios: {} },
    ];
    expect(gateFailures(empty, baselineOf(empty))).toEqual(
      [3_500, 7_000].flatMap((channels) =>
        SCENARIOS.map((name) => `${name} at ${channels}: not measured`)
      )
    );
  });

  it('fails scenarios that did none of their work, even against a baseline of them', () => {
    const idle = Object.fromEntries(SCENARIOS.map((name) => [name, zero()]));
    const measured: GatedRun[] = [
      { channels: 3_500, scenarios: idle },
      { channels: 7_000, scenarios: idle },
    ];
    const failures = gateFailures(measured, baselineOf(measured));
    expect(failures).toContain(
      'chatOpen at 3500: rows.rendered is 0, so the scenario did not run'
    );
    expect(failures).toContain(
      'appShell at 7000: sql.statements is 0, so the scenario did not run'
    );
    // Every scenario at both sizes: appShell, expand and collapse by one
    // count, chatOpen, unrelatedWrite and message by two.
    expect(failures).toHaveLength(18);
  });
});
