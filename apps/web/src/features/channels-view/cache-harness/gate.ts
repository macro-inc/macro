/**
 * What fails a run of the Chat cache harness (`AGENTS.md`, "Gate"). For every
 * scenario:
 *
 * 1. Drift: each gated count stays within `DRIFT_RATIO` (or `DRIFT_FLOOR`) of
 *    `baseline.json`, either way. More work is a regression; less is a win the
 *    baseline must record, so the next change is measured against it.
 * 2. Growth: no count at 2N is more than `GROWTH_LIMIT` times its count at N.
 *    Doubling the account may double the work, never more.
 * 3. Visible-window caps: a count that should follow what is on screen stays
 *    under its cap (`WINDOW_CAPS`) at both sizes, whatever the baseline says.
 * 4. Coverage: every size measured every scenario (`SCENARIOS`), and each did
 *    the work that shows it ran (`EVIDENCE`), so a run that measured nothing,
 *    or a baseline written from one, cannot pass.
 *
 * The baseline is generated (`writeBaseline`); limits and caps change only
 * here, by hand, in a reviewed change.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ChatScaleResult, ScenarioCounts } from './run-scale';

/** What `run-scale.tsx` measures, in order. */
export const SCENARIOS = [
  'appShell',
  'chatOpen',
  'unrelatedWrite',
  'message',
  'expand',
  'collapse',
] as const;

export type ScenarioName = (typeof SCENARIOS)[number];

export type GatedRun = {
  channels: number;
  scenarios: Partial<Record<ScenarioName, GatedCounts>>;
};

export const GATED_COUNTS = [
  'engine.calls',
  'engine.recordsOut',
  'engine.repeatViewReads',
  'sql.statements',
  'sql.rows',
  'network.operations',
  'server.rowsRequested',
  'server.rowsReturned',
  'mappers.calls',
  'mappers.built',
  'mappers.trackedWalks',
  'solid.owners',
  'solid.signals',
  'solid.storeNodes',
  'rows.built',
  'rows.resolved',
  'rows.rendered',
] as const;

export type GatedCount = (typeof GATED_COUNTS)[number];

export type GatedCounts = Record<GatedCount, number>;

/** A count may move this far from its baseline, as a share of it... */
const DRIFT_RATIO = 0.05;
/** ...or by this many, whichever is more, so a count near zero can move. */
const DRIFT_FLOOR = 5;
/** At most this many times the count at N, at 2N: twice, and 10% for noise. */
const GROWTH_LIMIT = 2.2;
/** Counts under this at N are compared as if they were this. */
const GROWTH_FLOOR = 10;

/**
 * Counts that are above zero whenever a scenario did what it is named for,
 * however much a change cuts its work: the shell's directory pass writes the
 * cache, the write is a statement, and every scenario from Chat's open on
 * has rows on screen.
 */
const EVIDENCE: Record<ScenarioName, readonly GatedCount[]> = {
  appShell: ['sql.statements'],
  chatOpen: ['engine.calls', 'rows.rendered'],
  unrelatedWrite: ['sql.statements', 'rows.rendered'],
  message: ['engine.calls', 'rows.rendered'],
  expand: ['rows.rendered'],
  collapse: ['rows.rendered'],
};

type WindowCaps = Partial<
  Record<ScenarioName, Partial<Record<GatedCount, number>>>
>;

/**
 * Work that should follow the window (48 rows of a fixed 816px sidebar), not
 * the account. Each cap is main's count on 2026-11-27 plus about 10%, the same
 * at N and 2N, so no change may add to it unseen; work that grows with the
 * account on main today (the directory, collapsed sections' unread rows) is
 * capped at its 2N count and fails at a larger account. Lower a cap when a
 * change lowers the count.
 */
const WINDOW_CAPS: WindowCaps = {
  chatOpen: {
    'engine.recordsOut': 1_770,
    'engine.repeatViewReads': 2,
    'server.rowsReturned': 400,
    'mappers.built': 22_400,
    'mappers.trackedWalks': 50,
    'solid.owners': 3_590,
    'solid.signals': 3_230,
    'solid.storeNodes': 48_400,
    'rows.resolved': 440,
    'rows.rendered': 53,
  },
  unrelatedWrite: {
    'engine.calls': 10,
    'engine.recordsOut': 0,
    'engine.repeatViewReads': 0,
    'network.operations': 0,
    'mappers.calls': 0,
    'solid.owners': 0,
    'solid.signals': 0,
    'solid.storeNodes': 0,
    'rows.rendered': 53,
  },
  message: {
    'engine.recordsOut': 1_310,
    'engine.repeatViewReads': 20,
    'server.rowsReturned': 330,
    'mappers.built': 21_900,
    'mappers.trackedWalks': 0,
    'solid.owners': 14,
    'solid.signals': 870,
    'solid.storeNodes': 8_600,
    'rows.resolved': 440,
    'rows.rendered': 53,
  },
  expand: {
    'engine.recordsOut': 0,
    'engine.repeatViewReads': 0,
    'mappers.built': 2_480,
    'mappers.trackedWalks': 0,
    'solid.signals': 0,
    'rows.resolved': 440,
    'rows.rendered': 53,
  },
  collapse: {
    'engine.recordsOut': 1_250,
    'engine.repeatViewReads': 2,
    'server.rowsReturned': 620,
    'mappers.built': 5_570,
    'mappers.trackedWalks': 0,
    'solid.signals': 1_250,
    'solid.storeNodes': 13_100,
    'rows.resolved': 590,
    'rows.rendered': 53,
  },
};

// A file path, not `new URL(..., import.meta.url)`, which Vite rewrites.
const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'baseline.json'
);

const BASELINE_SCHEMA = z.object({
  generatedBy: z.string(),
  sizes: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), z.number()))
  ),
});

export type Baseline = z.infer<typeof BASELINE_SCHEMA>;

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function gatedCounts(counts: ScenarioCounts): GatedCounts {
  const mappers = Object.values(counts.mappers);
  return {
    'engine.calls': counts.engine.calls,
    'engine.recordsOut': counts.engine.recordsOut,
    'engine.repeatViewReads': counts.engine.views.repeats,
    'sql.statements': counts.sql.statements,
    'sql.rows': counts.sql.rows,
    'network.operations': sum(Object.values(counts.network.operations)),
    'server.rowsRequested': counts.server.rowsRequested,
    'server.rowsReturned': counts.server.rowsReturned,
    'mappers.calls': sum(mappers.map((mapper) => mapper.calls)),
    'mappers.built': sum(mappers.map((mapper) => mapper.built)),
    'mappers.trackedWalks': sum(mappers.map((mapper) => mapper.trackedWalks)),
    'solid.owners': counts.solid.owners,
    'solid.signals': counts.solid.signals,
    'solid.storeNodes': counts.solid.storeNodes,
    'rows.built': counts.rows.built,
    'rows.resolved': counts.rows.resolved,
    'rows.rendered': counts.rows.rendered,
  };
}

/** The counts the gate reads from one size's run. */
export function gatedRun(result: ChatScaleResult): GatedRun {
  return {
    channels: result.channels,
    scenarios: Object.fromEntries(
      Object.entries(result.scenarios).map(([name, counts]) => [
        name,
        gatedCounts(counts),
      ])
    ),
  };
}

function scenarioEntries(run: GatedRun): [ScenarioName, GatedCounts][] {
  return Object.entries(run.scenarios) as [ScenarioName, GatedCounts][];
}

export function baselineOf(runs: GatedRun[]): Baseline {
  return {
    generatedBy:
      'just test-cache-harness-update (apps/web); see cache-harness/AGENTS.md',
    sizes: Object.fromEntries(
      runs.map((run) => [String(run.channels), run.scenarios])
    ),
  };
}

export function readBaseline(): Baseline {
  return BASELINE_SCHEMA.parse(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
}

export function writeBaseline(runs: GatedRun[]): void {
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(baselineOf(runs), null, 2)}\n`
  );
}

function driftFailures(runs: GatedRun[], baseline: Baseline): string[] {
  const failures: string[] = [];
  for (const run of runs) {
    const sized = baseline.sizes[String(run.channels)];
    if (!sized) {
      failures.push(`${run.channels} channels: no baseline for this size`);
      continue;
    }
    for (const name of Object.keys(sized)) {
      if (!(name in run.scenarios))
        failures.push(`${name} at ${run.channels}: no longer measured`);
    }
    for (const [name, actual] of scenarioEntries(run)) {
      const expected = sized[name];
      if (!expected) {
        failures.push(`${name} at ${run.channels}: no baseline`);
        continue;
      }
      for (const count of GATED_COUNTS) {
        const was = expected[count];
        if (was === undefined) {
          failures.push(`${name} at ${run.channels}: ${count} has no baseline`);
          continue;
        }
        const now = actual[count];
        const band = Math.max(was * DRIFT_RATIO, DRIFT_FLOOR);
        if (Math.abs(now - was) <= band) continue;
        const change = was === 0 ? 'from 0' : percent(now / was - 1);
        failures.push(
          `${name} at ${run.channels}: ${count} ${now}, baseline ${was} (${change}, band ±${Math.round(band)})`
        );
      }
    }
  }
  return failures;
}

function percent(ratio: number): string {
  const value = Math.round(ratio * 1000) / 10;
  return `${value > 0 ? '+' : ''}${value}%`;
}

function growthFailures(runs: GatedRun[]): string[] {
  const sorted = [...runs].sort((a, b) => a.channels - b.channels);
  const small = sorted[0];
  const large = sorted[sorted.length - 1];
  if (!small || !large || large.channels !== small.channels * 2)
    return ['the growth check needs a run at N and at 2N'];
  const failures: string[] = [];
  for (const [name, at2N] of scenarioEntries(large)) {
    const atN = small.scenarios[name];
    if (!atN) {
      failures.push(`${name}: measured at ${large.channels} only`);
      continue;
    }
    for (const count of GATED_COUNTS) {
      const limit = GROWTH_LIMIT * Math.max(atN[count], GROWTH_FLOOR);
      if (at2N[count] <= limit) continue;
      failures.push(
        `${name}: ${count} grew from ${atN[count]} at ${small.channels} to ${at2N[count]} at ${large.channels}, over ${GROWTH_LIMIT}×`
      );
    }
  }
  return failures;
}

function capFailures(runs: GatedRun[]): string[] {
  const failures: string[] = [];
  for (const run of runs) {
    for (const [name, actual] of scenarioEntries(run)) {
      const caps = WINDOW_CAPS[name];
      if (!caps) continue;
      for (const [count, cap] of Object.entries(caps) as [
        GatedCount,
        number,
      ][]) {
        if (actual[count] <= cap) continue;
        failures.push(
          `${name} at ${run.channels}: ${count} ${actual[count]} is over its visible-window cap ${cap}`
        );
      }
    }
  }
  return failures;
}

function coverageFailures(runs: GatedRun[]): string[] {
  const failures: string[] = [];
  for (const run of runs) {
    for (const name of SCENARIOS) {
      const counts = run.scenarios[name];
      if (!counts) {
        failures.push(`${name} at ${run.channels}: not measured`);
        continue;
      }
      for (const count of EVIDENCE[name]) {
        if (counts[count] > 0) continue;
        failures.push(
          `${name} at ${run.channels}: ${count} is 0, so the scenario did not run`
        );
      }
    }
  }
  return failures;
}

/** Every way the runs fail the gate, worded for the CI log; empty passes. */
export function gateFailures(runs: GatedRun[], baseline: Baseline): string[] {
  return [
    ...coverageFailures(runs),
    ...driftFailures(runs, baseline),
    ...growthFailures(runs),
    ...capFailures(runs),
  ];
}
