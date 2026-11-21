// The suggestions bench: generates suggestions for synthetic personas on a
// local stack, has a model mark them against each persona's answer key, and
// scores each section with one number you can hill climb. See README.md.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { type Stack, call, exclusive, login, sdk, searchIndexer, stack } from '../../scheduled_action/bench/stack';
import { keyGaps } from './catalog';
import { fixKeys, makeHeldout, spend, spent } from './heldout';
import { NO_LIST, judgeList, marksProblem, runFinding, scoreWorkList } from './finding';
import { JUDGE, asGrader, judgeCost, judgeFeed, judgeJobs, judgeRoutines, seedGraders } from './judge';
import { seedId } from '../../scheduled_action/bench/setup';
import { type Persona, type Variant, contentKey, keyDigests, ownerEmail, personaDigest, personas, scenarioName, seatOf, slotName, unnamedPersona, who } from './personas';
import { shiftDays } from './clock';
import { UNJUDGED, type Waiting, judgeWaiting } from './judging';
import { lines as reportLines, withheld, withheldAcross } from './report';
import { CACHE, type Trigger, generate, prepare, rereadList } from './run';
import { type Attempt, type RunFile, type Score, type Section, MIN_HELDOUT_PEOPLE, PARTS, contrast, failedScore, marginsOf, noiseMargins, scoreFeed, scoreRoutines, shareEnough, summary, unreadList, verdict, wholeCount } from './score';
import { comparable, joinRuns, sameBuild, staleKeys } from './sides';
import { startStub, stopStub, stubDir, writeFlags } from './stub';

type SectionSpec = {
  /** What it measures, for the report. */
  about: string;
  variant: Variant;
  trigger: Trigger;
  flags: Record<string, boolean>;
  /** Whether its sessions search the workspace, so seeded items need indexing. */
  search: boolean;
  /** The default size: copies of each persona run side by side, and rounds of them. */
  seats: number;
  reps: number;
  /**
   * Generations at once. Past about 20 agent sessions at once (nine onboarding
   * generations of three sessions each), the harness on a busy machine took
   * more than the 30 s it allows to accept a session's first prompt.
   */
  concurrency: number;
  /**
   * Whether a persona's judgements share a cached prefix: then every rep
   * reads its mail at one `now` and judging starts after the last rep.
   */
  judgeLast: boolean;
};

/**
 * Flags on in every section besides its own: what the people suggestions
 * reach have on. Event routines let a drafted routine start when mail
 * arrives, which most of the answer keys' drafted needs ask for.
 */
const BASE_FLAGS: Record<string, boolean> = { 'enable-event-routines': true };

export const SECTIONS: Record<Section, SectionSpec> = {
  routines: {
    about: 'Routine suggestions at signup: the onboarding generation with only routine suggestions on, for a person whose mailbox is all Macro has.',
    variant: 'signup',
    trigger: 'onboarding',
    flags: { ...BASE_FLAGS, 'enable-routine-suggestions': true },
    search: false,
    seats: 3,
    reps: 3,
    concurrency: 3,
    judgeLast: true,
  },
  feed: {
    about: 'The Suggestions feed: a "fresh suggestions" generation with only suggestions on, over a workspace in use for weeks.',
    variant: 'full',
    trigger: 'manual',
    flags: { ...BASE_FLAGS, 'enable-suggestions': true },
    search: true,
    seats: 3,
    reps: 3,
    // One session a generation.
    concurrency: 9,
    judgeLast: false,
  },
};

const RUNS = join(CACHE, 'runs');

const OPTIONS = {
  instance: { type: 'string', default: 'sugbench' },
  tempo: { type: 'string', default: process.env.TEMPO_URL ?? 'http://localhost:3200' },
  reps: { type: 'string' },
  seats: { type: 'string' },
  set: { type: 'string', default: 'tune' },
  personas: { type: 'string' },
  label: { type: 'string', default: 'local' },
  out: { type: 'string' },
  concurrency: { type: 'string' },
  model: { type: 'string', default: 'anthropic/claude-sonnet-5-5' },
  prompt: { type: 'string' },
  thinking: { type: 'string' },
  /** Flags to turn on besides the section's, comma-separated: a candidate behind a flag. */
  flags: { type: 'string' },
  margins: { type: 'string' },
} as const;

const commitOf = (dir: string) =>
  Bun.spawnSync(['git', 'rev-parse', '--short=10', 'HEAD'], { cwd: dir }).stdout.toString().trim() || 'unknown';

/** Flags are read fresh at each start, but the suggestions service trusts a person's flag for a minute. */
const FLAG_MEMO_MS = 61_000;

async function setFlags(instance: string, flags: Record<string, boolean>) {
  const path = join(stubDir(instance), 'flags.json');
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  writeFlags(instance, flags);
  if (before && before !== readFileSync(path, 'utf8')) {
    console.log('flags changed; waiting a minute for the services to stop trusting the old ones');
    await Bun.sleep(FLAG_MEMO_MS);
  }
}

/** Index every seeded item for search, and wait until each persona's documents are found. */
async function indexAll(at: Stack, people: Persona[], variant: Variant, now: number) {
  const indexer = searchIndexer(at);
  const headers = { 'x-internal-auth-key': indexer.key };
  for (const kind of ['documents', 'channels', 'projects', 'emails', 'calls', 'chats']) {
    const { job_id } = await call<{ job_id: string }>(`${indexer.url}/internal/backfill/${kind}`, { method: 'POST', headers, body: '{}' });
    for (let attempt = 0; ; attempt++) {
      const job = await call<{ status: string; error?: string }>(`${indexer.url}/internal/backfill/${job_id}`, { headers });
      if (job.status === 'completed') break;
      if (job.status !== 'running') throw new Error(`indexing ${kind} ${job.status}: ${job.error ?? ''}`);
      if (attempt >= 90) throw new Error(`indexing ${kind} still running after 3 minutes`);
      await Bun.sleep(2000);
    }
  }
  for (const persona of people) {
    const docs = Object.entries((persona.workspace.documents ?? {}) as Record<string, { name: string }>);
    if (!docs.length) continue;
    const [key, { name: probe }] = docs[0];
    const id = seedId(scenarioName(persona, variant), 'document', contentKey(key, shiftDays(now)));
    const macro = sdk(at, await login(at, ownerEmail(persona, variant)));
    for (let attempt = 0; ; attempt++) {
      let found = false;
      for await (const hit of macro.documents.search(probe, { searchOn: 'name', pageSize: 5 })) {
        if (hit.id === id) {
          found = true;
          break;
        }
      }
      if (found) break;
      if (attempt >= 60) throw new Error(persona.heldout ? "search still doesn't find a held-out person's probe 2 minutes after indexing" : `search still doesn't find "${probe}" for ${persona.name} 2 minutes after indexing`);
      await Bun.sleep(2000);
    }
  }
}

/** The flag that has onboarding find the work in a person's mail before drafting. */
const FIND_WORK_FLAG = 'routine-suggestions-find-work';

/** Whether a run of `section` scores `persona`'s work lists: the run had the finding step on (`findsWork`) and the persona has a streams key. */
const listsScored = (section: Section, persona: Persona, findsWork: boolean) => section === 'routines' && findsWork && !!persona.streamsTruth;

/** Forget `attempt`'s work-list judgement: its run, or its person's key, no longer scores one. */
const dropList = (attempt: Attempt) => {
  attempt.findingMarks = undefined;
  attempt.finding = undefined;
  attempt.findingError = undefined;
};

/**
 * Judge and score the work list `attempt`'s drafting sessions read, as
 * `find` scores one on its own, in place of any earlier judgement: a
 * generation that read none, its build failed or not, found nothing. A judge
 * that fails leaves no score, and says why.
 */
async function judgeWorkList(at: Stack, persona: Persona, attempt: Attempt) {
  attempt.findingMarks = undefined;
  attempt.finding = undefined;
  attempt.findingError = undefined;
  if (unreadList(attempt)) return;
  try {
    attempt.findingMarks = await judgeList(at, persona, attempt.generation.workList ?? NO_LIST, attempt.generation.now);
    attempt.finding = scoreWorkList(persona, attempt.generation.workList, attempt.findingMarks);
  } catch (error) {
    attempt.findingError = String(error).slice(0, 300);
  }
}

/** Judge and score one attempt as a grader no other judgement is using, so its cost is read from the grader's spend meanwhile; `findsWork` where its run had the finding step on. A build failure keeps its 0, and only its work list is judged. */
const judgeAndScore = (at: Stack, section: Section, persona: Persona, attempt: Attempt, findsWork: boolean) =>
  asGrader(async (grader) => {
    const started = new Date();
    try {
      if (section === 'routines') {
        if (!attempt.generation.buildFailed) {
          attempt.routineMarks = await judgeRoutines(at, grader, persona, attempt.generation);
          // A month persona's suggestions are judged a second time, for the stream jobs they do. That
          // judgement failing leaves the routines judged and scored, and only the jobs measure without it.
          attempt.jobMarks = undefined;
          attempt.jobError = undefined;
          if (persona.streamsTruth) {
            try {
              attempt.jobMarks = await judgeJobs(at, grader, persona, attempt.generation);
            } catch (error) {
              attempt.jobError = String(error).slice(0, 300);
            }
          }
          attempt.score = scoreRoutines(attempt.generation, attempt.routineMarks, persona.routinesTruth!, persona.streamsTruth, attempt.jobMarks);
        }
        if (listsScored(section, persona, findsWork)) await judgeWorkList(at, persona, attempt);
        else dropList(attempt);
      } else {
        attempt.feedMarks = await judgeFeed(at, grader, persona, attempt.generation);
        attempt.score = scoreFeed(attempt.generation, attempt.feedMarks, persona.feedTruth!);
      }
    } catch (error) {
      attempt.benchError = `judge: ${String(error).slice(0, 300)}`;
    }
    // Usage rows land as each call settles: give the last one a moment.
    await Bun.sleep(3000);
    attempt.judgeUsd = await judgeCost(at, grader, new Date(started.getTime() - 1000), new Date()).catch(() => 0);
  });

/** Run `work` for each item, at most `limit` at once. */
async function eachAtMost<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  }));
}

/** Seeds at once: each is a seed CLI process, and the first of a person signs them up. */
const SEEDING = 3;

/** Run `section` for every chosen persona, `reps` times, and write the run file as it goes. */
async function runSection(section: Section, values: Record<string, string | undefined>): Promise<string> {
  const spec = SECTIONS[section];
  const at = stack(values.instance!, values.tempo!);
  const set = values.set!;
  let people = personas(set);
  if (values.personas) {
    const chosen = values.personas.split(',');
    people = people.filter((persona) => chosen.includes(persona.name));
  }
  const truthKey = section === 'routines' ? 'routinesTruth' : 'feedTruth';
  people = people.filter((persona) => persona[truthKey]);
  if (!people.length) throw new Error(`no persona in set ${set} has a ${section} answer key`);
  if (section === 'routines') {
    const gaps = people.flatMap((persona) => keyGaps(persona.routinesTruth!).map((gap) => `${who(persona)}'s routines answer key ${gap}`));
    if (gaps.length) throw new Error(gaps.join('\n'));
  }
  const flags = { ...spec.flags, ...Object.fromEntries((values.flags ?? '').split(',').filter(Boolean).map((flag) => [flag.trim(), true])) };
  const reps = wholeCount('--reps', values.reps ?? spec.reps);
  const seats = wholeCount('--seats', values.seats ?? spec.seats);
  // Every copy of every persona is a person of its own: they run side by side.
  const slots = people.flatMap((persona) => Array.from({ length: seats }, (_, i) => seatOf(persona, i + 1)));
  const concurrency = wholeCount('--concurrency', values.concurrency ?? spec.concurrency);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(RUNS, `${values.label}-${section}-${set}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const out = values.out ?? join(dir, 'run.json');
  const run: RunFile = {
    section,
    label: values.label!,
    commit: commitOf(at.owner),
    set,
    startedAt: new Date().toISOString(),
    instance: at.instance,
    concurrency,
    seats,
    reps,
    judge: JUDGE,
    personas: Object.fromEntries(people.map((persona) => [persona.name, personaDigest(persona)])),
    keys: keyDigests(people),
    flags,
    attempts: [],
  };
  // Through a sibling file, so a run stopped mid-write keeps its last whole snapshot.
  const save = () => {
    writeFileSync(`${out}.tmp`, `${JSON.stringify(run, null, 1)}\n`);
    renameSync(`${out}.tmp`, out);
  };
  await exclusive(at.instance, `suggestions bench ${section}`, async () => {
    startStub(at.instance);
    await setFlags(at.instance, flags);
    await seedGraders(at.instance);
    const base = (slot: Persona, rep: number) => join(dir, `${slotName(slot).replace('/', '-')}-${rep}`);
    // Judging needs only what a generation wrote, so it runs on while the next
    // round seeds, except where a persona's judgements share a cached prefix
    // (`judgeLast`): there every rep reads the mail at one `now` and judging
    // waits for the last rep, so the prefix is written once a persona, not
    // once a rep.
    const runNow = Date.now();
    const judged: Promise<void>[] = [];
    const unjudged: Waiting<Persona, Attempt>[] = [];
    for (let rep = 1; rep <= reps; rep++) {
      const now = spec.judgeLast ? runNow : Date.now();
      await eachAtMost(slots, SEEDING, (slot) => unnamedErrors(slot, () => prepare(at, slot, spec.variant, now, base(slot, rep))));
      // A held-out set is read once its people are seeded and generations start.
      if (rep === 1 && set !== 'tune') {
        // Its keys are the ones its first use scored against, or this use fixes them.
        fixKeys(set, run.keys!);
        spend(set, section, values.label!);
      }
      if (spec.search) await indexAll(at, slots, spec.variant, now);
      await eachAtMost(slots, concurrency, async (slot) => {
        const generation = await unnamedErrors(slot, () => generate(at, slot, spec.variant, spec.trigger, now, base(slot, rep)));
        const attempt: Attempt = { section, label: run.label, persona: slot.name, seat: slot.seat, heldout: slot.heldout, rep, generation, judgeUsd: 0 };
        const truth = section === 'routines' ? slot.routinesTruth!.needs : slot.feedTruth!.planted;
        const record = () => {
          run.attempts.push(attempt);
          save();
        };
        const log = () => {
          const s = attempt.score;
          // A held-out person's scores stay unread (README, Held-out personas).
          if (slot.heldout) return console.log(`${section} held-out generation #${rep}: ${generation.buildFailed ? 'build failed' : attempt.benchError ? 'bench error' : 'scored'}`);
          console.log(
            `${section} ${slotName(slot)} #${rep}: ${generation.buildFailed ? `build failed (scored 0): ${generation.error}` : attempt.benchError ?? `score ${s!.score.toFixed(0)} (found ${s!.found}/${s!.needs}, bad ${s!.bad}, ${s!.suggestions} suggested), ${generation.status}, ${((generation.wallMs ?? 0) / 1000).toFixed(0)}s, ${generation.cost.usd.toFixed(3)}`}`,
          );
        };
        // A build failure scores 0 at once; its work list, where the run scores one, is judged all the same, so an unreliable build can't drop out of the finding score.
        const findsWork = !!flags[FIND_WORK_FLAG];
        const judging = generation.buildFailed ? listsScored(section, slot, findsWork) : !generation.error;
        if (generation.buildFailed) attempt.score = failedScore(truth.length, section === 'routines' ? slot.streamsTruth : undefined);
        else if (generation.error) attempt.benchError = `generation: ${generation.error}`;
        if (judging && spec.judgeLast) {
          // In the run file from now on, so a run that stops before judging
          // keeps its generations for `rejudge`.
          attempt.benchError = UNJUDGED;
          record();
          return void unjudged.push({ slot, attempt, log });
        }
        if (judging)
          return void judged.push(
            judgeAndScore(at, section, slot, attempt, findsWork).then(() => {
              record();
              log();
            }),
          );
        record();
        log();
      });
    }
    judged.push(...judgeWaiting(unjudged, (slot, attempt) => judgeAndScore(at, section, slot, attempt, !!flags[FIND_WORK_FLAG]), save));
    await Promise.all(judged);
  });
  save();
  console.log(`\n${reportLines([run]).join('\n')}\n\nwrote ${out}`);
  return out;
}

const readRun = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as RunFile;

/** `work`, whose error, for a held-out person, carries none of their names (personas.ts `unnamedPersona`). */
async function unnamedErrors<T>(persona: Persona, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!persona.heldout) throw error;
    throw new Error(`a held-out person's generation: ${unnamedPersona(persona, String(error))}`);
  }
}

/** A failed build's 0, as `run` scores one: with 0 stream jobs where its judge judges jobs (v5 on) and its person has a streams key. */
function rescoredFailure(run: RunFile, persona: Persona): Score {
  const needs = run.section === 'routines' ? persona.routinesTruth!.needs.length : persona.feedTruth!.planted.length;
  const judgesJobs = Number(/ v(\d+)$/.exec(run.judge ?? '')?.[1] ?? 0) >= 5;
  return failedScore(needs, run.section === 'routines' && judgesJobs ? persona.streamsTruth : undefined);
}

/** One side of a comparison: a run file, or several of one build joined with commas (sides.ts `joinRuns`). */
const readSide = (arg: string): RunFile => joinRuns(arg, arg.split(',').map(readRun));

/**
 * The digests of the answer keys `people` are scored against now, after
 * holding a held-out set to the keys its first use fixed (heldout.ts
 * `fixKeys`), so a rejudge or rescore scores against those keys or none.
 */
function keysNow(run: RunFile, people: Persona[]) {
  const keys = keyDigests(people);
  if (run.set !== 'tune') fixKeys(run.set, keys);
  return keys;
}

/** Judge and score a run again, without generating: for a changed judge or answer key. */
async function rejudge(path: string, values: Record<string, string | undefined>) {
  const run = readRun(path);
  const at = stack(values.instance!, values.tempo!);
  const people = new Map(personas(run.set).map((persona) => [persona.name, persona]));
  // The judge must read what the generations read: the same workspace and mail, spelled the same.
  const digests = run.personas;
  if (!digests) throw new Error(`${path} predates persona digests, so what its generations read is unknown: run it again instead`);
  const judged = [...new Set(run.attempts.map((attempt) => attempt.persona))].map((name) => {
    const persona = people.get(name);
    const heldout = run.attempts.some((attempt) => attempt.persona === name && attempt.heldout);
    if (!persona) throw new Error(`${path}: set ${run.set} no longer has ${heldout ? 'a held-out person of this run' : name}`);
    if (digests[name] !== personaDigest(persona)) throw new Error(`${path}: ${who(persona)}'s workspace or mail changed since this run: run it again instead`);
    return persona;
  });
  if (run.section === 'routines') {
    const gaps = judged.flatMap((persona) => (persona.routinesTruth ? keyGaps(persona.routinesTruth) : ['is missing']).map((gap) => `${who(persona)}'s routines answer key ${gap}`));
    if (gaps.length) throw new Error(gaps.join('\n'));
  }
  const keys = keysNow(run, judged);
  const findsWork = !!run.flags?.[FIND_WORK_FLAG];
  // The lists are read again from the sessions' transcripts, so a fix to reading them reaches
  // runs already made. All are read before judging starts: a transcript that can't be read is
  // that attempt's list error, never a failure partway through the judging.
  for (const attempt of run.attempts) {
    if (!attempt.generation.transcript || !listsScored(run.section, seatOf(people.get(attempt.persona)!, attempt.seat ?? 1), findsWork)) continue;
    const gone = rereadList(attempt.generation, path);
    // Its reason can hold a path with a held-out person's slug.
    if (gone) console.warn(attempt.heldout ? "a held-out generation: its work list couldn't be read again" : `${attempt.persona} rep ${attempt.rep}: ${gone}`);
  }
  // The judge's cost is read from the grader's usage, so nothing else may judge meanwhile.
  await exclusive(at.instance, 'suggestions bench rejudge', async () => {
    await seedGraders(at.instance);
    await Promise.all(
      run.attempts.map(async (attempt) => {
        const persona = seatOf(people.get(attempt.persona)!, attempt.seat ?? 1);
        // A build failure keeps its 0, with 0 stream jobs where its person has a streams key: only its work list is judged again, where the run scores one.
        if (attempt.generation.buildFailed) attempt.score = rescoredFailure({ ...run, judge: JUDGE }, persona);
        if (attempt.generation.buildFailed ? !listsScored(run.section, persona, findsWork) : attempt.generation.error) {
          // Nothing to judge again; a list judgement its key no longer backs goes.
          if (!listsScored(run.section, persona, findsWork)) dropList(attempt);
          return;
        }
        attempt.benchError = undefined;
        await judgeAndScore(at, run.section, persona, attempt, findsWork);
      }),
    );
  });
  const failed = run.attempts.filter((attempt) => (attempt.benchError && !attempt.generation.error) || attempt.findingError || attempt.jobError).length;
  if (failed) throw new Error(`${path}: ${failed} attempts, their stream jobs or their work lists could not be judged, so the run file is left as it was`);
  // Every attempt with marks was judged again: the run's marks are this judge's, against these keys.
  run.judge = JUDGE;
  run.keys = { ...run.keys, ...keys };
  writeFileSync(path, `${JSON.stringify(run, null, 1)}\n`);
  console.log(reportLines([run]).join('\n'));
}

/**
 * Score a run again from the marks it has: for a changed scoring, at no
 * cost. Its marks must have been judged against the answer keys as they are
 * now (sides.ts `staleKeys`); a changed key needs a rejudge.
 */
function rescore(path: string) {
  const run = readRun(path);
  const people = new Map(personas(run.set).map((persona) => [persona.name, persona]));
  const scoredHere = [...new Set(run.attempts.map((attempt) => attempt.persona))].map((name) => {
    const persona = people.get(name);
    if (!persona) throw new Error(`${path}: set ${run.set} no longer has ${run.attempts.some((attempt) => attempt.persona === name && attempt.heldout) ? 'a held-out person of this run' : name}`);
    return persona;
  });
  if (run.section === 'routines') {
    const gaps = scoredHere.flatMap((persona) => keyGaps(persona.routinesTruth!).map((gap) => `${who(persona)}'s routines answer key ${gap}`));
    if (gaps.length) throw new Error(gaps.join('\n'));
  }
  const keys = keyDigests(scoredHere);
  const stale = staleKeys(run, scoredHere, keys);
  if (stale) throw new Error(`${path}: ${stale} of ${scoredHere.length} people's answer keys changed since its marks were judged, or may have, so the run file is left as it was: rejudge it`);
  if (run.set !== 'tune') fixKeys(run.set, keys);
  const findsWork = !!run.flags?.[FIND_WORK_FLAG];
  for (const attempt of run.attempts) {
    const persona = people.get(attempt.persona)!;
    if (attempt.routineMarks) attempt.score = scoreRoutines(attempt.generation, attempt.routineMarks, persona.routinesTruth!, persona.streamsTruth, attempt.jobMarks);
    else if (attempt.feedMarks) attempt.score = scoreFeed(attempt.generation, attempt.feedMarks, persona.feedTruth!);
    else if (attempt.generation.buildFailed) attempt.score = rescoredFailure(run, persona);
    // A list its person's key no longer backs keeps no score from it.
    if (!listsScored(run.section, persona, findsWork || !!attempt.findingMarks)) {
      dropList(attempt);
      continue;
    }
    if (attempt.benchError || unreadList(attempt)) continue;
    // An empty list needs no judge; any other is scored from the marks it was judged with, which must fit it and the key as they are now.
    const list = attempt.generation.workList ?? NO_LIST;
    const marks = attempt.findingMarks ?? (list.streams.length ? undefined : []);
    if (!marks) continue;
    const problem = marksProblem(list, persona.streamsTruth!.streams, marks);
    if (problem) throw new Error(`${path}: ${attempt.heldout ? 'a held-out generation' : `${attempt.persona} #${attempt.rep}`}: its work list's marks don't fit the list and the key as they are now (${problem}), so the run file is left as it was: rejudge it`);
    attempt.findingMarks = marks;
    attempt.finding = scoreWorkList(persona, attempt.generation.workList, marks);
  }
  // Scored again against the keys as they are now.
  run.keys = { ...run.keys, ...keys };
  writeFileSync(path, `${JSON.stringify(run, null, 1)}\n`);
  console.log(reportLines([run]).join('\n'));
}

async function main() {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), options: OPTIONS, allowPositionals: true });
  const [command, ...rest] = positionals;
  switch (command) {
    case 'run': {
      const section = rest[0] as Section;
      if (!SECTIONS[section]) throw new Error(`sections: ${Object.keys(SECTIONS).join(', ')}`);
      await runSection(section, values);
      break;
    }
    case 'all': {
      const outs: string[] = [];
      for (const section of Object.keys(SECTIONS) as Section[]) outs.push(await runSection(section, { ...values, out: undefined }));
      console.log(`\n${reportLines(outs.map(readRun)).join('\n')}`);
      break;
    }
    case 'report':
      console.log(reportLines(rest.map(readSide)).join('\n'));
      break;
    case 'compare': {
      const [a, b] = rest.map(readSide);
      if (a.section !== b.section) throw new Error('compare two runs of the same section');
      comparable(a, b);
      const hidden = withheldAcross([a.attempts, b.attempts]);
      if (hidden) throw new Error(hidden);
      // Margins `noise` measured on these runs' kind of set and judge: score,found,bad.
      // Margins measured on another kind of set or by another judge would decide nothing: there are none by default.
      if (values.margins === undefined) throw new Error('compare needs --margins score,found,bad[,goodDrafts,jobDrafts]: measure them with `noise` on two runs of main on this kind of set, judged by this judge (README, Noise)');
      const measured = marginsOf(values.margins);
      const v = verdict(a.attempts, b.attempts, measured);
      const s = v.parts.score;
      console.log(`${a.section}: ${a.label} → ${b.label}, ${s.attempts[0]} and ${s.attempts[1]} attempts over ${s.people} personas\n\n**${v.verdict.toUpperCase()}**: ${v.why}.`);
      for (const part of Object.keys(PARTS) as (keyof typeof PARTS)[]) {
        const c = v.parts[part];
        const digits = part === 'score' ? 1 : 2;
        console.log(`- ${part}: ${c.a.toFixed(digits)} → ${c.b.toFixed(digits)}, ${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(digits)} (95% ${c.interval[0].toFixed(digits)} to ${c.interval[1].toFixed(digits)}), margin ${c.margin}: ${c.verdict}`);
      }
      // Good drafts of each measure, against the margins `noise` measured for them where given.
      for (const part of v.unshared) console.log(`- ${part}: not compared, the sides share too few people scored for it`);
      for (const [part, c] of Object.entries(v.good)) {
        console.log(`- ${part}: ${c.a.toFixed(2)} → ${c.b.toFixed(2)}, ${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(2)} (95% ${c.interval[0].toFixed(2)} to ${c.interval[1].toFixed(2)}), ${c.margin === undefined ? 'no margin given' : `margin ${c.margin}: ${c.verdict}`}`);
      }
      // Good catalog picks are reported, not judged against a margin: none has been measured for them.
      for (const [part, get] of [
        ['good catalog picks', (attempt: Attempt) => attempt.score?.goodPicks],
        ['good catalog picks by stream job', (attempt: Attempt) => attempt.score?.jobPicks],
      ] as const) {
        // Over the attempts scored for it: one whose jobs judgement failed has no picks by stream job.
        const having = (attempts: Attempt[]) => attempts.filter((attempt) => get(attempt) !== undefined);
        if (!having(a.attempts).length || !having(b.attempts).length) continue;
        if (!shareEnough(having(a.attempts), having(b.attempts))) {
          console.log(`- ${part}: not compared, the sides share too few people scored for it`);
          continue;
        }
        const c = contrast(having(a.attempts), having(b.attempts), (attempt) => get(attempt)!);
        console.log(`- ${part}: ${c.a.toFixed(2)} → ${c.b.toFixed(2)}, ${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(2)} (95% ${c.interval[0].toFixed(2)} to ${c.interval[1].toFixed(2)}), no margin`);
      }
      console.log(`- cost per generation: ${v.usd[0].toFixed(3)} → ${v.usd[1].toFixed(3)} (difference 95% ${v.usdInterval[0].toFixed(3)} to ${v.usdInterval[1].toFixed(3)})`);
      console.log(`- time: B/A median ${Number.isFinite(v.wallRatio) ? `×${v.wallRatio.toFixed(2)}` : `not shown (a side has no times, or fewer than ${MIN_HELDOUT_PEOPLE} held-out people timed)`}`);
      break;
    }
    case 'noise': {
      const [a, b] = rest.map(readSide);
      if (a.section !== b.section) throw new Error('noise takes two runs of the same section');
      comparable(a, b);
      sameBuild(a, b);
      const hidden = withheldAcross([a.attempts, b.attempts]);
      if (hidden) throw new Error(hidden);
      const n = noiseMargins(a.attempts, b.attempts);
      console.log(`${a.section}: ${n.score.attempts.join(' and ')} attempts of the same build over ${n.score.people} personas`);
      for (const [part, c] of Object.entries(n)) {
        const digits = part === 'score' ? 1 : 2;
        console.log(`- ${part}: moved ${c.delta.toFixed(digits)} (95% ${c.interval[0].toFixed(digits)} to ${c.interval[1].toFixed(digits)}, standard error ${c.se.toFixed(digits)}): margin ${c.margin.toFixed(digits)}`);
      }
      break;
    }
    case 'rejudge':
      for (const path of rest) await rejudge(path, values);
      break;
    case 'rescore':
      for (const path of rest) rescore(path);
      break;
    case 'stub':
      if (rest[0] === 'stop') stopStub(values.instance!);
      else startStub(values.instance!);
      break;
    case 'find': {
      let people = personas(values.set!);
      const keyless = people.filter((persona) => !persona.streamsTruth).length;
      if (keyless) throw new Error(`${keyless} of ${people.length} people in set ${values.set} have no streams key: find runs on a month set`);
      if (values.personas) people = people.filter((persona) => values.personas!.split(',').includes(persona.name));
      if (!people.length) throw new Error(`no persona in set ${values.set} is named ${values.personas}`);
      const reps = wholeCount('--reps', values.reps ?? 2);
      const concurrency = wholeCount('--concurrency', values.concurrency ?? 6);
      // Its lists are judged against the streams key: a held-out set's keys are the ones fixed at its first use.
      if (values.set !== 'tune') fixKeys(values.set!, keyDigests(people));
      // The step's cost is the author's usage while it runs: nothing else on the instance may write meanwhile.
      // A held-out use is recorded once the instance is held, so a find stopped while it waits spends none.
      await exclusive(values.instance!, 'suggestions bench find', () => {
        if (people.some((persona) => persona.heldout)) spend(values.set!, 'find', values.label!);
        return runFinding(stack(values.instance!, values.tempo!), people, {
          model: values.model!,
          thinking: values.thinking === 'low' ? 'low' : undefined,
          reps,
          label: values.label!,
          set: values.set!,
          prompt: values.prompt,
          concurrency,
        });
      });
      break;
    }
    case 'heldout':
      if (rest[0] === 'make') {
        if (rest[3] && rest[3] !== 'month') throw new Error('heldout make <name> [count] [month]');
        const count = wholeCount("heldout make's count", rest[2] ?? 3);
        // Its cost is the author's usage while it writes: nothing else on the instance may write meanwhile.
        await exclusive(values.instance!, 'suggestions bench heldout make', () => makeHeldout(stack(values.instance!, values.tempo!), rest[1], count, rest[3] === 'month'));
      }
      else console.log(spent().join('\n') || 'no held-out sets');
      break;
    case 'summary':
      for (const path of rest) {
        const run = readRun(path);
        console.log(withheld(run) ?? JSON.stringify(summary(run.attempts), null, 1));
      }
      break;
    default:
      console.log(`usage: bun bench.ts <command> [options]

  run <section>        generate, judge and score one section (${Object.keys(SECTIONS).join(', ')})
  all                  every section in turn
  report <run.json…>   the summary table of runs
  compare <a> <b>      B against A: win, loss or noise, with the parts
  noise <a> <b>        the margin two runs of the same build set
                       (a side may be several run.json joined by commas)
  rejudge <run.json…>  judge and score again without generating
  rescore <run.json…>  score again from the marks it has (a changed key), free
  stub [stop]          start or stop the stand-in
  find                 the finding step alone on a month set: --model, --prompt (default find.md), --reps
  heldout make <name> [count] [month] | heldout list
                       (month: 30 days of mail, up to 500 messages, and a streams key)

options: --instance sugbench --set tune|<held-out set> --personas a,b --label local
         --seats <copies of each persona> --reps <rounds> (default: the section's size)
         --concurrency <generations at once> (default: the section's) --out <file>
         --margins score,found,bad[,goodDrafts,jobDrafts] (compare: what noise measured on two runs of main)
         --flags a,b (flags to turn on besides the section's) --model, --thinking low, --prompt <file> (find)`);
  }
}

if (import.meta.main) await main();
