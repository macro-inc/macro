// From a judge's marks to one number per attempt, and from two runs to a
// verdict. An attempt's score is 100 × (found − bad) / needs: each need of the
// answer key met counts one, each suggestion with something wrong costs one,
// and a fine suggestion the key didn't plant counts nothing. So a run that
// finds everything and adds nothing wrong scores 100, one that suggests
// nothing scores 0, and noise drives it below 0.

import type { CardMark, FeedMarks, RoutineMark } from './judge';
import type { FeedTruth, RoutinesTruth } from './personas';
import type { Generation } from './run';

export type Section = 'routines' | 'feed';

export type Score = {
  score: number;
  /** Needs (routines) or planted opportunities (feed) in the answer key. */
  needs: number;
  found: number;
  missed: string[];
  suggestions: number;
  /** Suggestions with at least one thing wrong. */
  bad: number;
  invented: number;
  /** How many suggestions had each thing wrong; one may have several. */
  wrong: Record<string, number>;
  /** Mean keep (routines, 1–5) or worth (feed, 1–5) over the suggestions. */
  quality: number | null;
  /** The judge's rating of the whole feed, 1–10. */
  feedRating?: number;
};

export type Attempt = {
  section: Section;
  label: string;
  persona: string;
  heldout: boolean;
  rep: number;
  generation: Generation;
  routineMarks?: RoutineMark[];
  feedMarks?: FeedMarks;
  judgeUsd: number;
  /** The bench failed, not the build: seeding, the stack or the judge. Left out of scores. */
  benchError?: string;
  score?: Score;
};

export type RunFile = {
  section: Section;
  label: string;
  commit: string;
  set: string;
  startedAt: string;
  instance: string;
  concurrency: number;
  flags: Record<string, boolean>;
  attempts: Attempt[];
};

const count = (wrong: Record<string, number>, key: string, holds: boolean) => {
  if (holds) wrong[key] = (wrong[key] ?? 0) + 1;
};

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function scoreRoutines(generation: Generation, marks: RoutineMark[], truth: RoutinesTruth): Score {
  const needIds = new Set(truth.needs.map((need) => need.id));
  const freeDecoys = new Set(truth.decoys.filter((decoy) => !decoy.catalog?.length).map((decoy) => decoy.id));
  const found = new Set<string>();
  const wrong: Record<string, number> = {};
  let bad = 0;
  generation.routines.forEach((row, i) => {
    const mark = marks[i];
    // A catalog routine meets a need or falls for a decoy by its key alone,
    // whatever the judge says; a drafted one is the judge's call.
    const key = row.catalog_key;
    const meets = key
      ? truth.needs.filter((need) => need.catalog.includes(key)).map((need) => need.id)
      : mark.meets.filter((id) => needIds.has(id));
    const decoys = key
      ? [
          ...truth.decoys.filter((decoy) => decoy.catalog?.includes(key)).map((decoy) => decoy.id),
          ...mark.decoys.filter((id) => freeDecoys.has(id)),
        ]
      : mark.decoys.filter((id) => truth.decoys.some((decoy) => decoy.id === id));
    const flags: Record<string, boolean> = {
      decoy: decoys.length > 0,
      misfit: mark.misfit,
      broken: mark.broken,
      bad_knob: mark.bad_knob,
      wrong_surface: mark.wrong_surface,
      duplicate: mark.duplicate,
      unsafe: mark.unsafe,
      invented: mark.invented,
    };
    for (const [name, holds] of Object.entries(flags)) count(wrong, name, holds);
    if (Object.values(flags).some(Boolean)) bad++;
    // One that can't work or doesn't fit meets nothing.
    if (!mark.broken && !mark.unsafe && !mark.misfit) for (const id of meets) found.add(id);
  });
  const needs = truth.needs.length;
  return {
    score: (100 * (found.size - bad)) / needs,
    needs,
    found: found.size,
    missed: truth.needs.filter((need) => !found.has(need.id)).map((need) => need.id),
    suggestions: generation.routines.length,
    bad,
    invented: wrong.invented ?? 0,
    wrong,
    quality: mean(marks.map((mark) => mark.keep)),
  };
}

export function scoreFeed(generation: Generation, marks: FeedMarks, truth: FeedTruth): Score {
  const planted = new Set(truth.planted.map((item) => item.id));
  const decoyIds = new Set(truth.decoys.map((item) => item.id));
  const found = new Set<string>();
  const wrong: Record<string, number> = {};
  let bad = 0;
  for (const mark of marks.cards as CardMark[]) {
    const decoys = mark.decoys.filter((id) => decoyIds.has(id));
    const flags: Record<string, boolean> = {
      decoy: decoys.length > 0,
      stale: mark.stale,
      duplicate: mark.duplicate,
      unsafe: mark.unsafe,
      invented: mark.invented,
    };
    for (const [name, holds] of Object.entries(flags)) count(wrong, name, holds);
    if (Object.values(flags).some(Boolean)) bad++;
    if (!mark.unsafe) for (const id of mark.covers) if (planted.has(id)) found.add(id);
  }
  const needs = truth.planted.length;
  return {
    score: (100 * (found.size - bad)) / needs,
    needs,
    found: found.size,
    missed: truth.planted.filter((item) => !found.has(item.id)).map((item) => item.id),
    suggestions: marks.cards.length,
    bad,
    invented: wrong.invented ?? 0,
    wrong,
    quality: mean(marks.cards.map((mark) => mark.worth)),
    feedRating: marks.feed_rating,
  };
}

/** A generation the build failed (see `Generation.buildFailed`): it found nothing. */
export function failedScore(needs: number): Score {
  return { score: 0, needs, found: 0, missed: [], suggestions: 0, bad: 0, invented: 0, wrong: {}, quality: null };
}

// ---------- summaries ----------

export const scored = (attempts: Attempt[]) => attempts.filter((a): a is Attempt & { score: Score } => !a.benchError && !!a.score);

export function quantile(values: number[], q: number) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (at - low);
}

const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

export function summary(attempts: Attempt[]) {
  const done = scored(attempts);
  const wrong: Record<string, number> = {};
  for (const a of done) for (const [k, v] of Object.entries(a.score.wrong)) wrong[k] = (wrong[k] ?? 0) + v;
  const first = done.map((a) => a.generation.firstMs).filter((v): v is number => v !== undefined);
  const wall = done.map((a) => a.generation.wallMs).filter((v): v is number => v !== undefined);
  return {
    attempts: attempts.length,
    scored: done.length,
    benchErrors: attempts.length - done.length,
    score: avg(done.map((a) => a.score.score)),
    scoreInterval: interval(done.map((a) => a.score.score), avg),
    found: avg(done.map((a) => a.score.found)),
    needs: avg(done.map((a) => a.score.needs)),
    suggestions: avg(done.map((a) => a.score.suggestions)),
    bad: avg(done.map((a) => a.score.bad)),
    invented: avg(done.map((a) => a.score.invented)),
    wrongPerRun: Object.fromEntries(Object.entries(wrong).map(([k, v]) => [k, v / Math.max(1, done.length)])),
    quality: avg(done.flatMap((a) => (a.score.quality === null ? [] : [a.score.quality]))),
    feedRating: done.some((a) => a.score.feedRating !== undefined) ? avg(done.map((a) => a.score.feedRating ?? 0)) : undefined,
    failedGenerations: done.filter((a) => a.generation.status !== 'ready').length,
    firstMedianMs: quantile(first, 0.5),
    firstP90Ms: quantile(first, 0.9),
    wallMedianMs: quantile(wall, 0.5),
    usd: avg(done.map((a) => a.generation.cost.usd)),
    judgeUsd: avg(attempts.map((a) => a.judgeUsd)),
  };
}

// ---------- verdicts ----------

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

const BOOTSTRAP = 4000;

/** A 95% interval for `statistic` over `sample` resampled with replacement. */
export function interval<T>(sample: T[], statistic: (drawn: T[]) => number): [number, number] {
  if (sample.length < 2) return [NaN, NaN];
  const next = random(20261118);
  const values: number[] = [];
  for (let i = 0; i < BOOTSTRAP; i++) {
    values.push(statistic(Array.from({ length: sample.length }, () => sample[Math.floor(next() * sample.length)])));
  }
  return [quantile(values, 0.025), quantile(values, 0.975)];
}

type Pair = { a: Attempt & { score: Score }; b: Attempt & { score: Score } };

/** Attempts of the same persona and rep, one from each run. */
export function pairs(a: Attempt[], b: Attempt[]): Pair[] {
  const key = (attempt: Attempt) => `${attempt.persona}#${attempt.rep}`;
  const bs = new Map(scored(b).map((attempt) => [key(attempt), attempt]));
  return scored(a).flatMap((attempt) => {
    const other = bs.get(key(attempt));
    return other ? [{ a: attempt, b: other }] : [];
  });
}

export type Verdict = {
  verdict: 'win' | 'loss' | 'noise';
  why: string;
  pairs: number;
  delta: number;
  deltaInterval: [number, number];
  margin: number;
  parts: Record<string, [number, number]>;
  usd: [number, number];
  usdInterval: [number, number];
  wallRatio: number;
  wallInterval: [number, number];
};

/**
 * B against A on score: a win or loss only when the mean paired difference
 * is past `margin` (what main against main moves at this size) and its 95%
 * interval leaves zero. Cost and time are reported beside it, not folded in.
 */
export function verdict(a: Attempt[], b: Attempt[], margin: number): Verdict {
  const sample = pairs(a, b);
  if (sample.length < 3) throw new Error(`only ${sample.length} paired attempts; run both sides with the same personas and reps`);
  const delta = (drawn: Pair[]) => avg(drawn.map((pair) => pair.b.score.score - pair.a.score.score));
  const d = delta(sample);
  const deltaInterval = interval(sample, delta);
  let result: Verdict['verdict'] = 'noise';
  let why = `score moved ${d >= 0 ? '+' : ''}${d.toFixed(1)}, within the ${margin.toFixed(1)} noise margin or an interval that spans 0`;
  if (d > margin && deltaInterval[0] > 0) {
    result = 'win';
    why = `score rose ${d.toFixed(1)}, past the ${margin.toFixed(1)} margin`;
  } else if (d < -margin && deltaInterval[1] < 0) {
    result = 'loss';
    why = `score fell ${(-d).toFixed(1)}, past the ${margin.toFixed(1)} margin`;
  }
  const part = (get: (s: Score) => number): [number, number] => [avg(sample.map((p) => get(p.a.score))), avg(sample.map((p) => get(p.b.score)))];
  const usdDelta = (drawn: Pair[]) => avg(drawn.map((p) => p.b.generation.cost.usd - p.a.generation.cost.usd));
  const timed = sample.filter((p) => p.a.generation.wallMs && p.b.generation.wallMs);
  const ratio = (drawn: Pair[]) => Math.exp(quantile(drawn.map((p) => Math.log(p.b.generation.wallMs! / p.a.generation.wallMs!)), 0.5));
  return {
    verdict: result,
    why,
    pairs: sample.length,
    delta: d,
    deltaInterval,
    margin,
    parts: {
      found: part((s) => s.found),
      bad: part((s) => s.bad),
      invented: part((s) => s.invented),
      suggestions: part((s) => s.suggestions),
      quality: [avg(sample.flatMap((p) => (p.a.score.quality === null ? [] : [p.a.score.quality]))), avg(sample.flatMap((p) => (p.b.score.quality === null ? [] : [p.b.score.quality])))],
    },
    usd: [avg(sample.map((p) => p.a.generation.cost.usd)), avg(sample.map((p) => p.b.generation.cost.usd))],
    usdInterval: interval(sample, usdDelta),
    wallRatio: timed.length ? ratio(timed) : NaN,
    wallInterval: timed.length > 1 ? interval(timed, ratio) : [NaN, NaN],
  };
}

/**
 * The noise margin from two runs of the same build: the larger end of the
 * 95% interval of their paired score difference, i.e. how far apart two
 * identical builds land at this many attempts.
 */
export function noiseMargin(a: Attempt[], b: Attempt[]) {
  const sample = pairs(a, b);
  const delta = (drawn: Pair[]) => avg(drawn.map((pair) => pair.b.score.score - pair.a.score.score));
  const [lo, hi] = interval(sample, delta);
  return { pairs: sample.length, delta: delta(sample), interval: [lo, hi] as [number, number], margin: Math.max(Math.abs(lo), Math.abs(hi)) };
}
