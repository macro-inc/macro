import { match } from 'ts-pattern';
import { describe, expect, it } from 'vitest';
import {
  type ChatScaleRun,
  LOADS,
  limitFailures,
  STEP_NAMES,
  type StepMeasure,
  type StepName,
  summaryTable,
} from './limits';

const NO_REQUESTS = {
  requests: {},
  operations: {},
  subscriptions: {},
  sockets: {},
  defaulted: {},
};

/** One step at what a local run measured at 3,500 channels. */
function step(overrides: Partial<StepMeasure> = {}): StepMeasure {
  return {
    settleMs: 0,
    rowsMs: null,
    longTasks: { count: 10, totalMs: 1_000, maxMs: 170 },
    heapMb: 140,
    agentMemoryMb: null,
    domNodes: 1_622,
    rowsMounted: 40,
    server: { rowsRequested: 500, idsRequested: 0, rowsReturned: 500 },
    metrics: {},
    requests: NO_REQUESTS,
    ...overrides,
  };
}

function run(
  channels: number,
  change: (name: StepName) => Partial<StepMeasure> = () => ({})
): ChatScaleRun {
  const steps = Object.fromEntries(
    STEP_NAMES.map((name) => [
      name,
      step({
        rowsMs: LOADS.includes(name) ? 1_600 : null,
        ...change(name),
      }),
    ])
  ) as Record<StepName, StepMeasure>;
  return {
    channels,
    steps,
    backendErrors: [],
    pageErrors: [],
    requests: NO_REQUESTS,
  };
}

describe('limitFailures', () => {
  it('passes the sizes as they were measured', () => {
    expect(
      limitFailures([run(3_500), run(7_000, () => ({ heapMb: 180 }))])
    ).toEqual([]);
  });

  it('fails a run that measured nothing', () => {
    expect(limitFailures([])).toEqual(['no size was measured']);
  });

  it('fails a heap over its ceiling at that size', () => {
    expect(
      limitFailures([
        run(3_500, (name) => (name === 'seed' ? { heapMb: 1_410 } : {})),
      ])
    ).toEqual(['3500 channels, seed: heap (MB): 1410, limit 1400']);
  });

  it('holds the steps after the seed to a lower heap ceiling', () => {
    expect(
      limitFailures([
        run(3_500, (name) =>
          name === 'seed' || name === 'scroll' ? { heapMb: 560 } : {}
        ),
      ])
    ).toEqual(['3500 channels, scroll: heap (MB): 560, limit 550']);
  });

  it('holds loads and interactions to their own long task ceilings', () => {
    const failures = limitFailures([
      run(3_500, (name) =>
        name === 'coldOpen' || name === 'expand'
          ? { longTasks: { count: 1, totalMs: 1_600, maxMs: 1_600 } }
          : {}
      ),
    ]);
    expect(failures).toEqual([
      '3500 channels, expand: longest task (ms): 1600, limit 1500',
    ]);
  });

  it('holds rows on screen, the DOM and every long task total to its ceiling', () => {
    const failures = limitFailures([
      run(3_500, (name) =>
        match(name)
          .with('seed', () => ({ rowsMs: 8_100 }))
          .with('coldOpen', () => ({
            longTasks: { count: 300, totalMs: 241_000, maxMs: 900 },
          }))
          .with('scroll', () => ({
            longTasks: { count: 60, totalMs: 30_100, maxMs: 300 },
          }))
          .with('collapse', () => ({ domNodes: 4_100 }))
          .otherwise(() => ({}))
      ),
    ]);
    expect(failures).toEqual([
      '3500 channels, seed: rows on screen (ms): 8100, limit 8000',
      '3500 channels, coldOpen: long tasks in all (ms): 241000, limit 240000',
      '3500 channels, scroll: long tasks in all (ms): 30100, limit 30000',
      '3500 channels, collapse: DOM nodes: 4100, limit 4000',
    ]);
  });

  it('fails a load that never showed its rows', () => {
    expect(
      limitFailures([
        run(3_500, (name) => (name === 'coldOpen' ? { rowsMs: null } : {})),
      ])
    ).toEqual(['3500 channels, coldOpen: rows on screen never measured']);
  });

  it('fails a step whose readings are under the floors', () => {
    const empty = {
      heapMb: 0,
      domNodes: 0,
      longTasks: { count: 0, totalMs: 0, maxMs: 0 },
    };
    const failures = limitFailures([
      run(3_500, (name) =>
        name === 'seed' || name === 'message' ? empty : {}
      ),
    ]);
    expect(failures).toEqual([
      '3500 channels, seed: heap (MB): 0, at least 10',
      '3500 channels, seed: DOM nodes: 0, at least 200',
      '3500 channels, seed: long tasks: 0, at least 1',
      '3500 channels, message: heap (MB): 0, at least 10',
      '3500 channels, message: DOM nodes: 0, at least 200',
    ]);
  });

  it('fails a heap that grows with the account', () => {
    const failures = limitFailures([
      run(3_500),
      run(7_000, (name) => (name === 'expand' ? { heapMb: 310 } : {})),
    ]);
    expect(failures).toEqual([
      '3500 to 7000 channels, expand: heap growth: 2.21, limit 2.20',
    ]);
  });

  it('fails a DOM that grows with the account', () => {
    const failures = limitFailures([
      run(3_500),
      run(7_000, (name) => (name === 'scroll' ? { domNodes: 2_200 } : {})),
    ]);
    expect(failures).toEqual([
      '3500 to 7000 channels, scroll: DOM growth: 1.36, limit 1.20',
    ]);
  });

  it('compares short long-task totals from the floor', () => {
    const failures = limitFailures([
      run(3_500, () => ({ longTasks: { count: 1, totalMs: 100, maxMs: 100 } })),
      run(7_000, (name) =>
        name === 'message'
          ? { longTasks: { count: 8, totalMs: 2_600, maxMs: 300 } }
          : { longTasks: { count: 2, totalMs: 400, maxMs: 200 } }
      ),
    ]);
    expect(failures).toEqual([
      '3500 to 7000 channels, message: long task growth: 5.20, limit 5',
    ]);
  });

  it('allows a load more long task growth than an interaction', () => {
    const failures = limitFailures([
      run(3_500),
      run(7_000, (name) =>
        name === 'coldOpen' || name === 'scroll'
          ? { longTasks: { count: 60, totalMs: 6_000, maxMs: 400 } }
          : {}
      ),
    ]);
    expect(failures).toEqual([
      '3500 to 7000 channels, scroll: long task growth: 6, limit 5',
    ]);
  });

  it('checks growth only between a size and its double', () => {
    expect(
      limitFailures([run(3_500), run(5_000, () => ({ domNodes: 3_000 }))])
    ).toEqual(['5000 channels has no heap ceiling']);
  });
});

describe('summaryTable', () => {
  it('lists every step of every size', () => {
    const table = summaryTable([run(3_500), run(7_000)]).split('\n');
    expect(table).toHaveLength(2 + 2 * STEP_NAMES.length);
    expect(table[2]).toBe(
      '| 3500 | seed | 1600 | 140.0 | 1622 | 40 | 500 / 500 | 10 | 1000 | 170 | 0 |'
    );
  });
});
