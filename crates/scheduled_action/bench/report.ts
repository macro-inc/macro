// Summaries of results files and the verdict between two of them: win, loss
// or noise, on time and quality together.

import type { Arm } from './cases';
import type { Load } from './stack';
import type { Breakdown } from './trace';

export type Check = { says: string; holds: boolean };

export type Attempt = {
  case: string;
  arm: Arm;
  /** The build that answered, as the run was labelled. */
  label: string;
  round: number;
  traceId: string;
  startedAt: string;
  /** The timed part: request to answer (draft), or message to the routine existing (bare). */
  wallMs: number;
  status?: number;
  error?: string;
  draft?: import('./cases').DraftResult;
  /** Bare arm: the agent's last message, its turn's length, and whether it asked instead. */
  reply?: string;
  turnMs?: number;
  asked?: boolean;
  /** Channels the owner made while it drafted, which some checks read. */
  made?: string[];
  /** The mechanical checks on the draft. */
  quality: Check[];
  /** The run check: the drafted routine fired once. */
  run?: import('./runcheck').RunOutcome;
  /** The blind judge's grade. */
  grade?: import('./judge').Grade | { error: string };
  breakdown?: Breakdown;
  load: Load;
  /** The harness build that answered, when this eval set it (`drafts.ts harness`). */
  harness?: string;
  /** Bare arm: the agent session, for reading its spans again. */
  sessionId?: string;
};

export type Results = {
  label: string;
  arm: Arm;
  model: string;
  commit: string;
  startedAt: string;
  /** Other stacks whose harness was running when the run started. */
  stacks: string[];
  /** The databases' ids on the stack, which checks need besides the seeded ids. */
  databases?: Record<string, string>;
  attempts: Attempt[];
};

/** Every mechanical check held, and the run check too where the case has one and it ran. */
export const passedAll = (attempt: Attempt) =>
  attempt.quality.length > 0 && attempt.quality.every((check) => check.holds) && (attempt.run?.holds ?? true);

/**
 * It came back with a routine or a step: only these are timed. A draft that
 * failed, a bare turn that ended or ran out of time without a routine, and
 * the eval's own errors still count against quality (unless asking was
 * right) and as not under 15 s, so a build can't look faster by failing fast
 * or drop its slowest drafts by running out of time.
 */
export const delivered = (attempt: Attempt) =>
  attempt.error === undefined && (attempt.draft?.outcome === 'routine' || attempt.draft?.outcome === 'step');

const graded = (attempt: Attempt) =>
  attempt.grade && 'score' in attempt.grade ? attempt.grade.score : undefined;

export const quantile = (values: number[], q: number) => {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};
const median = (values: number[]) => quantile(values, 0.5);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN);
const s = (ms: number) => (Number.isNaN(ms) ? '–' : (ms / 1000).toFixed(1));
const pct = (share: number) => (Number.isNaN(share) ? '–' : `${Math.round(share * 100)}%`);

/** The target: every draft under this. */
export const TARGET_MS = 15_000;

export function summary(attempts: Attempt[]) {
  const timed = attempts.filter(delivered);
  const wall = timed.map((attempt) => attempt.wallMs);
  const with_ = timed.filter((attempt) => attempt.breakdown);
  const pick = (f: (b: Breakdown) => number) => with_.map((attempt) => f(attempt.breakdown as Breakdown));
  const grades = attempts.map(graded).filter((score): score is number => score !== undefined);
  const runs = attempts.filter((attempt) => attempt.run);
  return {
    attempts: attempts.length,
    median: median(wall),
    p90: quantile(wall, 0.9),
    worst: wall.length ? Math.max(...wall) : Number.NaN,
    // Of every request: one that got no routine didn't get one in 15 s.
    under: timed.filter((attempt) => attempt.wallMs < TARGET_MS).length / attempts.length,
    errors: attempts.filter((attempt) => attempt.error !== undefined).length,
    quality: attempts.filter(passedAll).length / attempts.length,
    mechanical:
      attempts.filter((attempt) => attempt.quality.length && attempt.quality.every((check) => check.holds)).length /
      attempts.length,
    runs: runs.length ? runs.filter((attempt) => attempt.run?.holds).length / runs.length : Number.NaN,
    judged: grades.length,
    judge: mean(grades),
    judgePass: grades.length ? grades.filter((score) => score >= 4).length / grades.length : Number.NaN,
    noDraft: attempts.filter((attempt) => attempt.draft?.outcome !== 'routine' && attempt.draft?.outcome !== 'step').length,
    setup: median(pick((b) => b.setupMs)),
    model: median(pick((b) => b.modelMs)),
    modelCalls: median(pick((b) => b.modelCalls)),
    firstToken: median(with_.flatMap((attempt) => attempt.breakdown?.firstChunkMs ?? []).filter((ms) => ms > 0)),
    toolWait: median(pick((b) => b.toolWaitMs)),
    tail: median(pick((b) => b.tailMs)),
    inputTokens: median(pick((b) => b.inputTokens)),
    outputTokens: median(pick((b) => b.outputTokens)),
    load: median(timed.map((attempt) => attempt.load.load1[0])),
  };
}

export type Summary = ReturnType<typeof summary>;

export const SUMMARY_HEADER = [
  '| | n | errors | median | p90 | worst | < 15 s | quality | mechanical | run | judge (pass) | no draft | setup | model (calls) | first token | tool wait | hand-back | tokens in / out | load |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];

export function summaryRow(name: string, row: Summary) {
  return `| ${name} | ${row.attempts} | ${row.errors} | ${s(row.median)} | ${s(row.p90)} | ${s(row.worst)} | ${pct(row.under)} | ${pct(row.quality)} | ${pct(row.mechanical)} | ${pct(row.runs)} | ${Number.isNaN(row.judge) ? '–' : row.judge.toFixed(1)} (${pct(row.judgePass)}) | ${row.noDraft} | ${s(row.setup)} | ${s(row.model)} (${row.modelCalls}) | ${s(row.firstToken)} | ${s(row.toolWait)} | ${s(row.tail)} | ${Math.round(row.inputTokens)} / ${Math.round(row.outputTokens)} | ${row.load.toFixed(0)} |`;
}

// ---------- verdict ----------

/**
 * How far the share of drafts passing every check may fall before a change
 * counts as drafting worse. Measured by running main against itself (see
 * README); a run of a different size needs its own measurement.
 */
export const QUALITY_MARGIN = 0.1;

/** A seeded generator, so a verdict is the same every time it's computed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pair = { a: Attempt; b: Attempt };

/** Attempts of the same case in the same round, one from each side. */
export function pairs(a: Attempt[], b: Attempt[]): Pair[] {
  const key = (attempt: Attempt) => `${attempt.case}#${attempt.round}`;
  const bs = new Map(b.map((attempt) => [key(attempt), attempt]));
  return a.flatMap((attempt) => {
    const other = bs.get(key(attempt));
    return other ? [{ a: attempt, b: other }] : [];
  });
}

const BOOTSTRAP = 4000;

/** A 95% interval for `statistic` over pairs resampled with replacement. */
function interval(sample: Pair[], statistic: (pairs: Pair[]) => number): [number, number] {
  const next = random(20261112);
  const values: number[] = [];
  for (let i = 0; i < BOOTSTRAP; i++) {
    const drawn = Array.from({ length: sample.length }, () => sample[Math.floor(next() * sample.length)]);
    values.push(statistic(drawn));
  }
  return [quantile(values, 0.025), quantile(values, 0.975)];
}

export type Verdict = {
  verdict: 'win' | 'loss' | 'noise';
  why: string;
  pairs: number;
  /** Pairs where both sides came back with a routine, which the time compares. */
  timedPairs: number;
  /** B's time over A's, per pair: median and 95% interval. */
  timeRatio: number;
  timeInterval: [number, number];
  timeVerdict: 'win' | 'loss' | 'noise';
  quality: [number, number];
  qualityDelta: number;
  qualityInterval: [number, number];
  margin: number;
};

/**
 * B against A. Time: the median of B's time over A's across pairs of the
 * same case and round, a win or loss only when its 95% interval leaves 1.
 * Quality: the share passing every check may not fall by more than `margin`.
 */
export function verdict(a: Attempt[], b: Attempt[], margin = QUALITY_MARGIN): Verdict {
  const sample = pairs(a, b);
  if (sample.length < 5) throw new Error(`only ${sample.length} paired attempts; run both sides on the same rounds`);
  // Time compares the pairs where both sides came back with a routine; quality counts every pair.
  const timedPairs = sample.filter((pair) => delivered(pair.a) && delivered(pair.b));
  if (timedPairs.length < 5) throw new Error(`only ${timedPairs.length} pairs where both sides came back with a routine`);
  const ratio = (drawn: Pair[]) => Math.exp(median(drawn.map((pair) => Math.log(pair.b.wallMs / pair.a.wallMs))));
  const share = (drawn: Pair[], side: 'a' | 'b') => drawn.filter((pair) => passedAll(pair[side])).length / drawn.length;
  const delta = (drawn: Pair[]) => share(drawn, 'b') - share(drawn, 'a');
  const timeRatio = ratio(timedPairs);
  const timeInterval = interval(timedPairs, ratio);
  const timeVerdict = timeInterval[1] < 1 ? 'win' : timeInterval[0] > 1 ? 'loss' : 'noise';
  const qualityDelta = delta(sample);
  const qualityInterval = interval(sample, delta);
  const quality: [number, number] = [share(sample, 'a'), share(sample, 'b')];
  let result: Verdict['verdict'];
  let why: string;
  if (qualityDelta < -margin) {
    result = 'loss';
    why = `quality fell ${pct(-qualityDelta)}, more than the ${pct(margin)} margin`;
  } else if (timeVerdict === 'win') {
    result = 'win';
    why = `faster (×${timeRatio.toFixed(2)}) and quality within the margin`;
  } else if (timeVerdict === 'loss') {
    result = 'loss';
    why = `slower (×${timeRatio.toFixed(2)})`;
  } else if (qualityDelta > margin) {
    result = 'win';
    why = `quality rose ${pct(qualityDelta)}, time within noise`;
  } else {
    result = 'noise';
    why = 'time and quality within noise';
  }
  return {
    verdict: result,
    why,
    pairs: sample.length,
    timedPairs: timedPairs.length,
    timeRatio,
    timeInterval,
    timeVerdict,
    quality,
    qualityDelta,
    qualityInterval,
    margin,
  };
}

export function verdictLines(v: Verdict) {
  return [
    `**${v.verdict.toUpperCase()}**: ${v.why}.`,
    '',
    `- time: B/A median ×${v.timeRatio.toFixed(2)} (95% ${v.timeInterval[0].toFixed(2)}–${v.timeInterval[1].toFixed(2)}) over ${v.timedPairs} pairs: ${v.timeVerdict}`,
    `- quality (every check passed): ${pct(v.quality[0])} → ${pct(v.quality[1])}, ${v.qualityDelta >= 0 ? '+' : ''}${pct(v.qualityDelta)} (95% ${pct(v.qualityInterval[0])} to ${pct(v.qualityInterval[1])}); margin ${pct(v.margin)}`,
  ];
}
