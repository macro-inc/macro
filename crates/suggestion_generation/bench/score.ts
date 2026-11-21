// From a judge's marks to one number per attempt, and from two runs to a
// verdict. An attempt's score is 100 × (found − bad) / needs: each need of the
// answer key met counts one, each suggestion with something wrong costs one,
// and a fine suggestion the key didn't plant counts nothing. So a run that
// finds everything and adds nothing wrong scores 100, one that suggests
// nothing scores 0, and noise drives it below 0.

import { CATALOG } from './catalog';
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
  /** Which copy of the persona ran it (personas.ts `seat`); 1 in runs from before seats. */
  seat?: number;
  heldout: boolean;
  rep: number;
  generation: Generation;
  routineMarks?: RoutineMark[];
  feedMarks?: FeedMarks;
  judgeUsd: number;
  /** The bench failed, not the build (seeding, the stack or the judge), or the attempt waits to be judged. Left out of scores. */
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
  /** Copies of each persona and rounds of them; absent in runs from before seats (1 and 3). */
  seats?: number;
  reps?: number;
  /** The judge its marks come from (`JUDGE` in judge.ts); absent in runs judged before it was recorded. */
  judge?: string;
  /**
   * Each persona's `personaDigest` as its generations read it, so a rejudge
   * reads the same; absent in runs from before it was recorded.
   */
  personas?: Record<string, string>;
  flags: Record<string, boolean>;
  attempts: Attempt[];
};

const count = (wrong: Record<string, number>, key: string, holds: boolean) => {
  if (holds) wrong[key] = (wrong[key] ?? 0) + 1;
};

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * What is wrong with a catalog pick, from the answer key and the catalog
 * alone, so the same pick scores the same every time. Only what the session
 * wrote for it is the judge's: its reason (invented) and the knobs it set.
 */
export function catalogFlags(generation: Generation, i: number, mark: RoutineMark, truth: RoutinesTruth, key: string): Record<string, boolean> {
  const row = generation.routines[i];
  const knobs = Object.keys(row.knob_values ?? {}).length > 0;
  return {
    decoy: truth.decoys.some((decoy) => decoy.catalog?.includes(key)),
    misfit: truth.misfit.includes(key),
    broken: knobs && mark.broken,
    bad_knob: knobs && mark.bad_knob,
    wrong_surface: !CATALOG[key]?.surfaces.includes(row.surfaces[0]),
    duplicate: generation.routines.slice(0, i).some((earlier) => earlier.catalog_key === key),
    unsafe: false,
    invented: mark.invented,
  };
}

export function scoreRoutines(generation: Generation, marks: RoutineMark[], truth: RoutinesTruth): Score {
  const needIds = new Set(truth.needs.map((need) => need.id));
  const found = new Set<string>();
  const wrong: Record<string, number> = {};
  let bad = 0;
  generation.routines.forEach((row, i) => {
    const mark = marks[i];
    // A catalog routine is scored by its key (catalogFlags); a drafted one is the judge's call.
    const key = row.catalog_key;
    const meets = key
      ? truth.needs.filter((need) => need.catalog.includes(key)).map((need) => need.id)
      : mark.meets.filter((id) => needIds.has(id));
    const flags: Record<string, boolean> = key
      ? catalogFlags(generation, i, mark, truth, key)
      : {
          decoy: mark.decoys.some((id) => truth.decoys.some((decoy) => decoy.id === id)),
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
    // One that can't work or doesn't fit meets nothing: for a catalog pick, by its key too.
    if (!flags.broken && !flags.unsafe && !flags.misfit) for (const id of meets) found.add(id);
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

type Done = Attempt & { score: Score };

/** The parts a comparison reports, and which way is better. */
export const PARTS = { score: 1, found: 1, bad: -1 } as const;
export type Part = keyof typeof PARTS;

function byPersona(attempts: Attempt[]) {
  const groups = new Map<string, Done[]>();
  for (const attempt of scored(attempts)) groups.set(attempt.persona, [...(groups.get(attempt.persona) ?? []), attempt]);
  return groups;
}

/** Student's t at 97.5% for `df` degrees of freedom (Cornish–Fisher; within 0.01 from 7 up, 0.025 at 5). */
function t975(df: number) {
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
}

/**
 * B against A on `get`: for each persona both ran, B's mean less A's, then
 * the mean over personas, so sides of any size compare and a persona that
 * runs more often doesn't outweigh the others. The 95% interval is the
 * difference ± t × its standard error, from each persona's spread on each
 * side (a persona with one attempt on a side takes the spread of the rest).
 */
export function contrast(a: Attempt[], b: Attempt[], get: (attempt: Done) => number) {
  const as = byPersona(a);
  const bs = byPersona(b);
  const people = [...as.keys()].filter((name) => bs.has(name)).sort();
  if (!people.length) throw new Error('the two runs share no scored persona');
  const groups = people.flatMap((name) => [as.get(name)!.map(get), bs.get(name)!.map(get)]);
  const squares = (values: number[]) => values.reduce((sum, v) => sum + (v - avg(values)) ** 2, 0);
  const df = groups.reduce((n, values) => n + values.length - 1, 0);
  const pooled = df > 0 ? groups.reduce((sum, values) => sum + squares(values), 0) / df : NaN;
  const spread = (values: number[]) => (values.length > 1 ? squares(values) / (values.length - 1) : pooled);
  const se = Math.sqrt(groups.reduce((sum, values) => sum + spread(values) / values.length, 0)) / people.length;
  const delta = avg(people.map((_, i) => avg(groups[2 * i + 1]) - avg(groups[2 * i])));
  const half = t975(Math.max(1, df)) * se;
  return {
    people: people.length,
    attempts: [people.reduce((n, name) => n + as.get(name)!.length, 0), people.reduce((n, name) => n + bs.get(name)!.length, 0)] as [number, number],
    a: avg(people.map((_, i) => avg(groups[2 * i]))),
    b: avg(people.map((_, i) => avg(groups[2 * i + 1]))),
    delta,
    interval: [delta - half, delta + half] as [number, number],
    /** The standard error of `delta`. */
    se,
  };
}

export type Margins = Record<Part, number>;

export type PartVerdict = ReturnType<typeof contrast> & { margin: number; verdict: 'better' | 'worse' | 'noise' };

export type Verdict = {
  verdict: 'win' | 'loss' | 'noise';
  why: string;
  parts: Record<Part, PartVerdict>;
  usd: [number, number];
  usdInterval: [number, number];
  wallRatio: number;
};

const get: Record<Part, (attempt: Done) => number> = {
  score: (attempt) => attempt.score.score,
  found: (attempt) => attempt.score.found,
  bad: (attempt) => attempt.score.bad,
};

/**
 * B against A: a win or a loss only when the score moved past its margin
 * (what main against main moves it by at the default size) and its 95%
 * interval leaves zero. Found and bad get a verdict of their own, against
 * margins of their own, which show a change in one before the score can.
 * Cost and time are reported beside it, not folded in.
 */
export function verdict(a: Attempt[], b: Attempt[], margins: Margins): Verdict {
  const parts = Object.fromEntries(
    (Object.keys(PARTS) as Part[]).map((part) => {
      const c = contrast(a, b, get[part]);
      const margin = margins[part];
      const better = PARTS[part] * c.delta > margin && (PARTS[part] > 0 ? c.interval[0] > 0 : c.interval[1] < 0);
      const worse = PARTS[part] * c.delta < -margin && (PARTS[part] > 0 ? c.interval[1] < 0 : c.interval[0] > 0);
      return [part, { ...c, margin, verdict: better ? 'better' : worse ? 'worse' : 'noise' }];
    }),
  ) as Record<Part, PartVerdict>;
  const s = parts.score;
  if (s.attempts[0] < 3 || s.attempts[1] < 3) throw new Error(`only ${s.attempts.join(' and ')} scored attempts; run both sides with the same personas`);
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const result: Verdict['verdict'] = s.verdict === 'better' ? 'win' : s.verdict === 'worse' ? 'loss' : 'noise';
  const why =
    result === 'noise'
      ? `score moved ${signed(s.delta)}, within the ${s.margin.toFixed(1)} noise margin or an interval that spans 0`
      : `score moved ${signed(s.delta)}, past the ${s.margin.toFixed(1)} margin`;
  const usd = contrast(a, b, (attempt) => attempt.generation.cost.usd);
  const timed = (attempts: Attempt[]) => attempts.filter((attempt) => attempt.generation.wallMs);
  const median = (attempts: Attempt[]) => quantile(scored(timed(attempts)).map((attempt) => attempt.generation.wallMs!), 0.5);
  return { verdict: result, why, parts, usd: [usd.a, usd.b], usdInterval: usd.interval, wallRatio: median(b) / median(a) };
}

/**
 * The noise margins from two runs of the same build: for each part, the
 * larger end of the 95% interval of their difference, i.e. how far apart
 * two identical builds land at this size.
 */
export function noiseMargins(a: Attempt[], b: Attempt[]) {
  return Object.fromEntries(
    (Object.keys(PARTS) as Part[]).map((part) => {
      const c = contrast(a, b, get[part]);
      return [part, { ...c, margin: Math.max(Math.abs(c.interval[0]), Math.abs(c.interval[1])) }];
    }),
  ) as Record<Part, ReturnType<typeof contrast> & { margin: number }>;
}
