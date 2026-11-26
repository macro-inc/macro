// From a judge's marks to one number per attempt, and from two runs to a
// verdict. An attempt's score is 100 × (found − bad) / needs: each need of the
// answer key met counts one, each suggestion with something wrong costs one,
// and a fine suggestion the key didn't plant counts nothing. So a run that
// finds everything and adds nothing wrong scores 100, one that suggests
// nothing scores 0, and noise drives it below 0.

import { CATALOG } from './catalog';
import type { CardMark, FeedMarks, JobMark, RoutineMark } from './judge';
import type { FeedTruth, RoutinesTruth, StreamsTruth } from './personas';
import type { EntryMark, ListScore } from './finding';
import type { Generation } from './run';

export type Section = 'routines' | 'feed';

/** The fewest held-out people an aggregate is shown over: fewer would show one person's result. */
export const MIN_HELDOUT_PEOPLE = 2;

/**
 * Whether a measure taken over `having`, the attempts of `run` that have it,
 * is an aggregate: in a run with held-out people, only over two of them or
 * more. Each measure asks of the attempts that have it (the timed ones, the
 * ones whose list was read), since a run where two people scored but one was
 * timed would show that one's time.
 */
export function aggregate(having: Attempt[], run: Attempt[] = having): boolean {
  if (!run.some((attempt) => attempt.heldout)) return true;
  return heldoutPeople(having) >= MIN_HELDOUT_PEOPLE;
}

/**
 * How many held-out people `attempts` holds a result of their own for. A
 * failed build is a known 0 that says nothing of its person, so a person all
 * of whose builds failed doesn't count: beside one other person, the
 * aggregate would be that person's result halved.
 */
export function heldoutPeople(attempts: Attempt[]): number {
  return new Set(attempts.filter((attempt) => attempt.heldout && !attempt.generation.buildFailed).map((attempt) => attempt.persona)).size;
}

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
  /** Routines: drafted suggestions, and the good ones of each kind: each meets a need and has nothing wrong. */
  drafts?: number;
  goodDrafts?: number;
  goodPicks?: number;
  /** A month persona: work streams of its key that some suggestion acts on, of how many. */
  aimed?: number;
  workStreams?: number;
  /**
   * The second measure of good, for a month persona judged for stream jobs:
   * suggestions of each kind with nothing wrong (the same flags as good drafts
   * and picks) that do at least one work stream's real job right, whether or
   * not a need of the key bundles that stream with others; and the work
   * streams whose jobs the good drafts do.
   */
  jobDrafts?: number;
  jobPicks?: number;
  jobStreams?: number;
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
  /** A month persona's stream jobs judgement, beside `routineMarks`. */
  jobMarks?: JobMark[];
  /** Its stream jobs judgement failed: its routines are scored all the same, and it is left out of the jobs measure only. */
  jobError?: string;
  feedMarks?: FeedMarks;
  /** The work list its drafting session read, matched to the persona's streams key. */
  findingMarks?: EntryMark[];
  finding?: ListScore;
  /** Its work list couldn't be judged; its routines are scored all the same. */
  findingError?: string;
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
  /**
   * Each persona's `keyDigest`: the answer keys its attempts were scored
   * against, so two runs are set side by side only when scored against the
   * same keys; absent in runs from before it was recorded (`rescore` adds it).
   */
  keys?: Record<string, string>;
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

export function scoreRoutines(generation: Generation, marks: RoutineMark[], truth: RoutinesTruth, streams?: StreamsTruth, jobs?: JobMark[]): Score {
  const needIds = new Set(truth.needs.map((need) => need.id));
  const work = new Set(streams?.streams.filter((stream) => stream.kind === 'work').map((stream) => stream.id));
  const found = new Set<string>();
  const aimed = new Set<string>();
  const jobStreams = new Set<string>();
  const wrong: Record<string, number> = {};
  let bad = 0;
  let goodDrafts = 0;
  let goodPicks = 0;
  let jobDrafts = 0;
  let jobPicks = 0;
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
    const flawed = Object.values(flags).some(Boolean);
    if (flawed) bad++;
    // One that can't work or doesn't fit meets nothing: for a catalog pick, by its key too.
    if (!flags.broken && !flags.unsafe && !flags.misfit) for (const id of meets) found.add(id);
    // Good: it meets a need of the key and nothing is wrong with it.
    if (meets.length && !flawed) {
      if (key) goodPicks++;
      else goodDrafts++;
    }
    for (const id of mark.streams ?? []) if (work.has(id)) aimed.add(id);
    // The second measure: a work stream's job done right, and nothing wrong.
    const done = (jobs?.[i]?.jobs ?? []).filter((id) => work.has(id));
    if (jobs && done.length && !flawed) {
      if (key) jobPicks++;
      else {
        jobDrafts++;
        for (const id of done) jobStreams.add(id);
      }
    }
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
    drafts: generation.routines.filter((row) => !row.catalog_key).length,
    goodDrafts,
    goodPicks,
    ...(streams ? { aimed: aimed.size, workStreams: work.size } : {}),
    ...(streams && jobs ? { jobDrafts, jobPicks, jobStreams: jobStreams.size } : {}),
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

/**
 * A generation the build failed (see `Generation.buildFailed`): it found
 * nothing. A month persona's (one with a streams key) also aimed at no work
 * stream and did no stream's job, so it counts in those measures as well.
 */
export function failedScore(needs: number, streams?: StreamsTruth): Score {
  const failed: Score = { score: 0, needs, found: 0, missed: [], suggestions: 0, bad: 0, invented: 0, wrong: {}, quality: null, drafts: 0, goodDrafts: 0, goodPicks: 0 };
  if (!streams) return failed;
  const work = streams.streams.filter((stream) => stream.kind === 'work').length;
  return { ...failed, aimed: 0, workStreams: work, jobDrafts: 0, jobPicks: 0, jobStreams: 0 };
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

/** A summary's stream jobs measure: its numbers, or how few held-out people it would show. */
type JobsSummary = { jobDrafts?: number; jobPicks?: number; jobStreams?: number; fiveJobDrafts?: number; jobScored?: number; jobErrors?: number; jobWithheld?: number };

export function summary(attempts: Attempt[]) {
  const done = scored(attempts);
  const wrong: Record<string, number> = {};
  for (const a of done) for (const [k, v] of Object.entries(a.score.wrong)) wrong[k] = (wrong[k] ?? 0) + v;
  // Each measure over the attempts that have it, and none (NaN) where those hold fewer held-out people than an aggregate needs.
  const over = (has: (a: (typeof done)[number]) => number | undefined | null) => {
    const having = done.filter((a) => has(a) !== undefined && has(a) !== null);
    return aggregate(having, attempts) ? having.map((a) => has(a)!) : [];
  };
  const first = over((a) => a.generation.firstMs);
  const wall = over((a) => a.generation.wallMs);
  const last = over((a) => a.generation.lastMs);
  const qualities = over((a) => a.score.quality);
  const lists = done.flatMap((a) => (a.finding ? [a.finding] : []));
  // A list the session never read scores as an empty one, so it can't make another person's list an
  // aggregate; one read before its build failed was judged as read, and counts its person.
  const listPeople = new Set(done.filter((a) => a.heldout && a.finding && !a.finding.unread).map((a) => a.persona)).size;
  const listsShown = !attempts.some((a) => a.heldout) || listPeople >= MIN_HELDOUT_PEOPLE;
  const rated = done.filter((a) => a.score.feedRating !== undefined);
  const listErrors = done.filter((a) => a.findingError).length;
  const jobbed = done.filter((a) => a.score.jobDrafts !== undefined);
  const total = (f: (list: ListScore) => number) => lists.reduce((sum, list) => sum + f(list), 0);
  // Runs judged before the stream jobs judgement (v5) have none of these. Each is over the
  // attempts that have it: a failed build counts 0, an attempt whose jobs judgement failed is
  // left out (`jobErrors`), as a bench error is left out of every measure. A held-out measure
  // shows only over two held-out people or more, like every other (`jobWithheld` counts them).
  const jobErrors = done.filter((a) => a.jobError).length;
  const jobs: JobsSummary = !jobbed.length
    ? {}
    : !aggregate(jobbed, attempts)
      ? { jobWithheld: heldoutPeople(jobbed), jobErrors }
      : {
          jobDrafts: avg(jobbed.map((a) => a.score.jobDrafts!)),
          jobPicks: avg(jobbed.map((a) => a.score.jobPicks!)),
          jobStreams: avg(jobbed.map((a) => a.score.jobStreams!)),
          fiveJobDrafts: jobbed.filter((a) => a.score.jobDrafts! >= 5).length,
          jobScored: jobbed.length,
          jobErrors,
        };
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
    quality: qualities.length ? avg(qualities) : NaN,
    // A generation with no rating counts 0, so a held-out rating shows only where two people or more were rated.
    feedRating: !rated.length ? undefined : aggregate(rated, attempts) ? avg(done.map((a) => a.score.feedRating ?? 0)) : NaN,
    // Routines runs scored before good suggestions were counted have none of these.
    ...(done.length && done.every((a) => a.score.goodDrafts !== undefined)
      ? {
          drafts: avg(done.map((a) => a.score.drafts!)),
          goodDrafts: avg(done.map((a) => a.score.goodDrafts!)),
          goodPicks: avg(done.map((a) => a.score.goodPicks!)),
          fiveGoodDrafts: done.filter((a) => a.score.goodDrafts! >= 5).length,
        }
      : {}),
    ...(done.length && done.every((a) => a.score.aimed !== undefined)
      ? { aimed: avg(done.map((a) => a.score.aimed!)), workStreams: avg(done.map((a) => a.score.workStreams!)) }
      : {}),
    ...jobs,
    failedGenerations: done.filter((a) => a.generation.status !== 'ready').length,
    // Generations run to find the work: how many drafting sessions read a list, what share of the key's work streams the lists named (none where no list was read), and how many entries named none.
    // Where every judgement failed, `lists` is 0 and the shares are NaN: the report says none could be judged.
    ...(lists.length || listErrors
      ? {
          finding: listsShown ? {
            lists: lists.length,
            read: lists.filter((list) => !list.unread).length,
            errors: listErrors,
            found: total((list) => list.found) / Math.max(1, total((list) => list.work)),
            unreal: total((list) => list.unreal) / lists.length,
            listed: total((list) => list.listed) / lists.length,
          } : { withheld: listPeople, errors: listErrors },
        }
      : {}),
    firstMedianMs: quantile(first, 0.5),
    firstP90Ms: quantile(first, 0.9),
    lastMedianMs: quantile(last, 0.5),
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

/**
 * Good suggestions, each a part of its own beside the score: good drafts
 * (they meet a need of the key) and good drafts by stream job (they do a work
 * stream's job right). Each is judged against a margin `noise` measured, or
 * reported without one.
 */
export const GOOD_PARTS = { goodDrafts: 1, jobDrafts: 1 } as const;
export type GoodPart = keyof typeof GOOD_PARTS;

const goodGet: Record<GoodPart, (attempt: Done) => number | undefined> = {
  goodDrafts: (attempt) => attempt.score.goodDrafts,
  jobDrafts: (attempt) => attempt.score.jobDrafts,
};

/** Whether `attempt` is scored for good part `part`: one whose jobs judgement failed isn't for `jobDrafts`. */
const hasGood = (part: GoodPart) => (attempt: Attempt) => scored([attempt]).length === 1 && goodGet[part](attempt as Done) !== undefined;

/**
 * Whether two sides' attempts share people enough to be set side by side:
 * one at least, and where either holds held-out people, as many held-out
 * people as an aggregate needs, so no comparison shows one person's result.
 */
export function shareEnough(a: Attempt[], b: Attempt[]): boolean {
  const inA = new Set(scored(a).map((attempt) => attempt.persona));
  const common = scored(b).filter((attempt) => inA.has(attempt.persona));
  if (!common.length) return false;
  if (![...a, ...b].some((attempt) => attempt.heldout)) return true;
  // Each side holds a result of its own for every person it counts.
  const built = new Set(scored(a).filter((attempt) => !attempt.generation.buildFailed).map((attempt) => attempt.persona));
  return heldoutPeople(common.filter((attempt) => built.has(attempt.persona))) >= MIN_HELDOUT_PEOPLE;
}

/** The good parts both sides have, each over the attempts scored for it. */
const goodParts = (a: Attempt[], b: Attempt[]) => (Object.keys(GOOD_PARTS) as GoodPart[]).filter((part) => a.some(hasGood(part)) && b.some(hasGood(part)));

/** The good parts both sides have and share people enough for (`shareEnough`); the rest are `unshared`. */
const sharedGoodParts = (a: Attempt[], b: Attempt[]) => {
  const parts = goodParts(a, b);
  const shared = parts.filter((part) => shareEnough(a.filter(hasGood(part)), b.filter(hasGood(part))));
  return { shared, unshared: parts.filter((part) => !shared.includes(part)) };
};

/** B against A for good part `part`, over the attempts of each side scored for it. */
const goodContrast = (a: Attempt[], b: Attempt[], part: GoodPart) => contrast(a.filter(hasGood(part)), b.filter(hasGood(part)), (attempt) => goodGet[part](attempt)!);

export type Margins = Record<Part, number> & Partial<Record<GoodPart, number>>;

export type PartVerdict = ReturnType<typeof contrast> & { margin: number; verdict: 'better' | 'worse' | 'noise' };

export type Verdict = {
  verdict: 'win' | 'loss' | 'noise';
  why: string;
  parts: Record<Part, PartVerdict>;
  /** Good drafts of each measure both sides have; without a margin, `unmeasured`. */
  good: Partial<Record<GoodPart, ReturnType<typeof contrast> & { margin?: number; verdict: 'better' | 'worse' | 'noise' | 'unmeasured' }>>;
  /** Good parts both sides have but share too few people scored for (`shareEnough`): not compared. */
  unshared: GoodPart[];
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
  const { shared, unshared } = sharedGoodParts(a, b);
  const good = Object.fromEntries(
    shared.map((part) => {
      const c = goodContrast(a, b, part);
      const margin = margins[part];
      if (margin === undefined) return [part, { ...c, verdict: 'unmeasured' as const }];
      const better = c.delta > margin && c.interval[0] > 0;
      const worse = c.delta < -margin && c.interval[1] < 0;
      return [part, { ...c, margin, verdict: better ? ('better' as const) : worse ? ('worse' as const) : ('noise' as const) }];
    }),
  ) as Verdict['good'];
  const s = parts.score;
  if (s.attempts[0] < 3 || s.attempts[1] < 3) throw new Error(`only ${s.attempts.join(' and ')} scored attempts; run both sides with the same personas`);
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const result: Verdict['verdict'] = s.verdict === 'better' ? 'win' : s.verdict === 'worse' ? 'loss' : 'noise';
  const why =
    result === 'noise'
      ? `score moved ${signed(s.delta)}, within the ${s.margin.toFixed(1)} noise margin or an interval that spans 0`
      : `score moved ${signed(s.delta)}, past the ${s.margin.toFixed(1)} margin`;
  const usd = contrast(a, b, (attempt) => attempt.generation.cost.usd);
  const timed = (attempts: Attempt[]) => scored(attempts).filter((attempt) => attempt.generation.wallMs);
  // Both medians over the people timed on both sides, so the ratio sets the same people side by side.
  const timedIn = (attempts: Attempt[]) => new Set(timed(attempts).map((attempt) => attempt.persona));
  const both = new Set([...timedIn(a)].filter((persona) => timedIn(b).has(persona)));
  const common = (attempts: Attempt[]) => timed(attempts).filter((attempt) => both.has(attempt.persona));
  // A side's median shows only over two held-out people's times or more.
  const median = (attempts: Attempt[]) => (aggregate(common(attempts), attempts) ? quantile(common(attempts).map((attempt) => attempt.generation.wallMs!), 0.5) : NaN);
  return { verdict: result, why, parts, good, unshared, usd: [usd.a, usd.b], usdInterval: usd.interval, wallRatio: median(b) / median(a) };
}

/**
 * `compare`'s `--margins score,found,bad[,goodDrafts,jobDrafts]`, as `noise`
 * prints them: three or five finite margins of 0 or more. A margin of 0 is a
 * measurement (two runs that never moved); one that isn't finite would call
 * every change noise.
 */
export function marginsOf(text: string): Margins {
  const margins = text.split(',').map((margin) => (margin.trim() ? Number(margin) : NaN));
  if (margins.length < 3 || margins.length > 5 || margins.some((margin) => !Number.isFinite(margin) || margin < 0)) {
    throw new Error(`--margins takes score,found,bad, then goodDrafts and jobDrafts as \`noise\` prints them: three to five finite margins of 0 or more, not ${text}`);
  }
  return { score: margins[0], found: margins[1], bad: margins[2], ...(margins.length > 3 ? { goodDrafts: margins[3] } : {}), ...(margins.length > 4 ? { jobDrafts: margins[4] } : {}) };
}

/** Most of anything the bench counts out (reps, seats, people, calls at once). */
const MAX_COUNT = 1000;

/** `value` as a whole number from 1 to `MAX_COUNT`; `what` names it in the refusal. */
export function wholeCount(what: string, value: string | number): number {
  const n = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) throw new Error(`${what} takes a whole number from 1 to ${MAX_COUNT}, not ${value}`);
  return n;
}

/** Whether `attempt`'s list couldn't be read, marking it so: its own failure, never an empty list. */
export function unreadList(attempt: Attempt): boolean {
  if (!attempt.generation.listError) return false;
  attempt.findingMarks = undefined;
  attempt.finding = undefined;
  attempt.findingError = `reading the list: ${attempt.generation.listError}`;
  return true;
}

/**
 * The noise margins from two runs of the same build: for each part, the
 * larger end of the 95% interval of their difference, i.e. how far apart
 * two identical builds land at this size.
 */
export function noiseMargins(a: Attempt[], b: Attempt[]) {
  const margin = (c: ReturnType<typeof contrast>) => ({ ...c, margin: Math.max(Math.abs(c.interval[0]), Math.abs(c.interval[1])) });
  return {
    ...(Object.fromEntries((Object.keys(PARTS) as Part[]).map((part) => [part, margin(contrast(a, b, get[part]))])) as Record<Part, ReturnType<typeof margin>>),
    ...(Object.fromEntries(sharedGoodParts(a, b).shared.map((part) => [part, margin(goodContrast(a, b, part))])) as Partial<Record<GoodPart, ReturnType<typeof margin>>>),
  };
}
