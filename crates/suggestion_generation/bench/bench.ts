// The suggestions bench: generates suggestions for synthetic personas on a
// local stack, has a model mark them against each persona's answer key, and
// scores each section with one number you can hill climb. See README.md.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { type Stack, call, exclusive, login, sdk, searchIndexer, stack } from '../../scheduled_action/bench/stack';
import { keyGaps } from './catalog';
import { makeHeldout, spend, spent } from './heldout';
import { JUDGE, asGrader, judgeCost, judgeFeed, judgeRoutines, seedGraders } from './judge';
import { seedId } from '../../scheduled_action/bench/setup';
import { type Persona, type Variant, contentKey, ownerEmail, personaDigest, personas, scenarioName, seatOf, slotName } from './personas';
import { shiftDays } from './clock';
import { UNJUDGED, type Waiting, judgeWaiting } from './judging';
import { lines as reportLines } from './report';
import { CACHE, type Trigger, generate, prepare } from './run';
import { type Attempt, type Margins, type RunFile, type Section, PARTS, failedScore, noiseMargins, scoreFeed, scoreRoutines, summary, verdict } from './score';
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

/**
 * How far two runs of main land apart on each part, at the default size
 * (3 personas × 3 seats × 3 reps): the far end of the 95% interval of their
 * difference, from `noise` (README, Noise). A smaller move is noise; a run
 * of another size needs margins of its own.
 */
export const MARGINS: Record<Section, Margins> = {
  routines: { score: 11.5, found: 0.47, bad: 0.53 },
  feed: { score: 11.0, found: 0.84, bad: 0.42 },
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
  margin: { type: 'string' },
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
      if (attempt >= 60) throw new Error(`search still doesn't find "${probe}" for ${persona.name} 2 minutes after indexing`);
      await Bun.sleep(2000);
    }
  }
}

/** Judge and score one attempt as a grader no other judgement is using, so its cost is read from the grader's spend meanwhile. */
const judgeAndScore = (at: Stack, section: Section, persona: Persona, attempt: Attempt) =>
  asGrader(async (grader) => {
    const started = new Date();
    try {
      if (section === 'routines') {
        attempt.routineMarks = await judgeRoutines(at, grader, persona, attempt.generation);
        attempt.score = scoreRoutines(attempt.generation, attempt.routineMarks, persona.routinesTruth!);
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
    const gaps = people.flatMap((persona) => keyGaps(persona.routinesTruth!).map((gap) => `${persona.name}'s routines answer key ${gap}`));
    if (gaps.length) throw new Error(gaps.join('\n'));
  }
  const reps = Number(values.reps ?? spec.reps);
  const seats = Number(values.seats ?? spec.seats);
  // Every copy of every persona is a person of its own: they run side by side.
  const slots = people.flatMap((persona) => Array.from({ length: seats }, (_, i) => seatOf(persona, i + 1)));
  const concurrency = Math.max(1, Number(values.concurrency ?? spec.concurrency));
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
    flags: spec.flags,
    attempts: [],
  };
  // Through a sibling file, so a run stopped mid-write keeps its last whole snapshot.
  const save = () => {
    writeFileSync(`${out}.tmp`, `${JSON.stringify(run, null, 1)}\n`);
    renameSync(`${out}.tmp`, out);
  };
  await exclusive(at.instance, `suggestions bench ${section}`, async () => {
    startStub(at.instance);
    await setFlags(at.instance, spec.flags);
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
      await eachAtMost(slots, SEEDING, (slot) => prepare(at, slot, spec.variant, now, base(slot, rep)));
      // A held-out set is read once its people are seeded and generations start.
      if (rep === 1 && set !== 'tune') spend(set, section, values.label!);
      if (spec.search) await indexAll(at, slots, spec.variant, now);
      await eachAtMost(slots, concurrency, async (slot) => {
        const generation = await generate(at, slot, spec.variant, spec.trigger, now, base(slot, rep));
        const attempt: Attempt = { section, label: run.label, persona: slot.name, seat: slot.seat, heldout: slot.heldout, rep, generation, judgeUsd: 0 };
        const truth = section === 'routines' ? slot.routinesTruth!.needs : slot.feedTruth!.planted;
        const record = () => {
          run.attempts.push(attempt);
          save();
        };
        const log = () => {
          const s = attempt.score;
          console.log(
            `${section} ${slotName(slot)} #${rep}: ${generation.buildFailed ? `build failed (scored 0): ${generation.error}` : attempt.benchError ?? `score ${s!.score.toFixed(0)} (found ${s!.found}/${s!.needs}, bad ${s!.bad}, ${s!.suggestions} suggested), ${generation.status}, ${((generation.wallMs ?? 0) / 1000).toFixed(0)}s, ${generation.cost.usd.toFixed(3)}`}`,
          );
        };
        if (generation.buildFailed) attempt.score = failedScore(truth.length);
        else if (generation.error) attempt.benchError = `generation: ${generation.error}`;
        else if (spec.judgeLast) {
          // In the run file from now on, so a run that stops before judging
          // keeps its generations for `rejudge`.
          attempt.benchError = UNJUDGED;
          record();
          return void unjudged.push({ slot, attempt, log });
        } else
          return void judged.push(
            judgeAndScore(at, section, slot, attempt).then(() => {
              record();
              log();
            }),
          );
        record();
        log();
      });
    }
    judged.push(...judgeWaiting(unjudged, (slot, attempt) => judgeAndScore(at, section, slot, attempt), save));
    await Promise.all(judged);
  });
  save();
  console.log(`\n${reportLines([run]).join('\n')}\n\nwrote ${out}`);
  return out;
}

const readRun = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as RunFile;

/** The digest a run recorded for a persona, if it recorded one. */
const digestOf = (run: RunFile, name: string) => (run.personas && Object.hasOwn(run.personas, name) ? run.personas[name] : undefined);

/**
 * One side of a comparison: a run file, or several of the same section
 * joined with commas, read as one run whose reps follow on (the second
 * file's rep 1 is rep 4 after a 3-rep run), so runs pair up rep for rep.
 */
function readSide(arg: string): RunFile {
  const runs = arg.split(',').map(readRun);
  for (const field of ['section', 'set', 'judge'] as const) {
    if (new Set(runs.map((run) => run[field])).size > 1) throw new Error(`${arg} mixes ${field}s`);
  }
  if (runs.length > 1 && runs.some((run) => !run.judge)) throw new Error(`${arg} joins runs with no judge recorded, which may come from different judges`);
  // A persona read two ways can't be one side's.
  const personas = new Map<string, string>();
  for (const run of runs.length > 1 ? runs : []) {
    for (const name of new Set(run.attempts.map((attempt) => attempt.persona))) {
      const digest = digestOf(run, name);
      if (!digest) throw new Error(`${arg} joins a run with no digest of ${name}, so what its generations read is unknown: run it again`);
      if ((personas.get(name) ?? digest) !== digest) throw new Error(`${arg} joins runs that read ${name}'s workspace or mail differently`);
      personas.set(name, digest);
    }
  }
  let offset = 0;
  const attempts = runs.flatMap((run) => {
    const shifted = run.attempts.map((attempt) => ({ ...attempt, rep: attempt.rep + offset }));
    offset += Math.max(0, ...run.attempts.map((attempt) => attempt.rep));
    return shifted;
  });
  const joined = (values: string[]) => [...new Set(values)].join('+');
  return { ...runs[0], label: joined(runs.map((run) => run.label)), commit: joined(runs.map((run) => run.commit)), attempts, ...(runs.length > 1 && { personas: Object.fromEntries(personas) }) };
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
    if (!persona) throw new Error(`${path}: set ${run.set} no longer has ${name}`);
    if (digests[name] !== personaDigest(persona)) throw new Error(`${path}: ${name}'s workspace or mail changed since this run: run it again instead`);
    return persona;
  });
  if (run.section === 'routines') {
    const gaps = judged.flatMap((persona) => (persona.routinesTruth ? keyGaps(persona.routinesTruth) : ['is missing']).map((gap) => `${persona.name}'s routines answer key ${gap}`));
    if (gaps.length) throw new Error(gaps.join('\n'));
  }
  // The judge's cost is read from the grader's usage, so nothing else may judge meanwhile.
  await exclusive(at.instance, 'suggestions bench rejudge', async () => {
    await seedGraders(at.instance);
    await Promise.all(
      run.attempts.map(async (attempt) => {
        if (attempt.generation.error) return; // a build failure keeps its 0
        attempt.benchError = undefined;
        await judgeAndScore(at, run.section, seatOf(people.get(attempt.persona)!, attempt.seat ?? 1), attempt);
      }),
    );
  });
  const failed = run.attempts.filter((attempt) => attempt.benchError && !attempt.generation.error).length;
  if (failed) throw new Error(`${path}: ${failed} attempts could not be judged, so the run file is left as it was`);
  run.judge = JUDGE;
  writeFileSync(path, `${JSON.stringify(run, null, 1)}\n`);
  console.log(reportLines([run]).join('\n'));
}

/** Two sides judged by one judge on the same personas, or why they can't be set side by side. */
function comparable(a: RunFile, b: RunFile) {
  for (const side of [a, b]) {
    // Runs from before the judge was recorded may come from different judges too.
    if (!side.judge) throw new Error(`${side.label} has no judge recorded, so its marks may come from another judge: run it again`);
  }
  if (a.judge !== b.judge) {
    throw new Error(`${a.label} and ${b.label} were judged by different judges (${a.judge ?? 'unrecorded'}, ${b.judge ?? 'unrecorded'}): rejudge the older one first`);
  }
  // A changed mailbox or workspace would read as a change of build.
  const names = (run: RunFile) => new Set(run.attempts.map((attempt) => attempt.persona));
  const inB = names(b);
  for (const name of [...names(a)].filter((name) => inB.has(name))) {
    const [da, db] = [digestOf(a, name), digestOf(b, name)];
    if (!da || !db) throw new Error(`${(da ? b : a).label} has no digest of ${name}, so what its generations read is unknown: run it again`);
    if (da !== db) throw new Error(`${a.label} and ${b.label} read ${name}'s workspace or mail differently`);
  }
}

/** Score a run again from the marks it has, with the answer keys as they are now: for a changed key or scoring, at no cost. */
function rescore(path: string) {
  const run = readRun(path);
  const people = new Map(personas(run.set).map((persona) => [persona.name, persona]));
  if (run.section === 'routines') {
    const gaps = [...people.values()].flatMap((persona) => keyGaps(persona.routinesTruth!).map((gap) => `${persona.name}'s routines answer key ${gap}`));
    if (gaps.length) throw new Error(gaps.join('\n'));
  }
  for (const attempt of run.attempts) {
    const persona = people.get(attempt.persona)!;
    if (attempt.routineMarks) attempt.score = scoreRoutines(attempt.generation, attempt.routineMarks, persona.routinesTruth!);
    else if (attempt.feedMarks) attempt.score = scoreFeed(attempt.generation, attempt.feedMarks, persona.feedTruth!);
  }
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
      const margins = { ...MARGINS[a.section], ...(values.margin ? { score: Number(values.margin) } : {}) };
      const v = verdict(a.attempts, b.attempts, margins);
      const s = v.parts.score;
      console.log(`${a.section}: ${a.label} → ${b.label}, ${s.attempts[0]} and ${s.attempts[1]} attempts over ${s.people} personas\n\n**${v.verdict.toUpperCase()}**: ${v.why}.`);
      for (const part of Object.keys(PARTS) as (keyof typeof PARTS)[]) {
        const c = v.parts[part];
        const digits = part === 'score' ? 1 : 2;
        console.log(`- ${part}: ${c.a.toFixed(digits)} → ${c.b.toFixed(digits)}, ${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(digits)} (95% ${c.interval[0].toFixed(digits)} to ${c.interval[1].toFixed(digits)}), margin ${c.margin}: ${c.verdict}`);
      }
      console.log(`- cost per generation: ${v.usd[0].toFixed(3)} → ${v.usd[1].toFixed(3)} (difference 95% ${v.usdInterval[0].toFixed(3)} to ${v.usdInterval[1].toFixed(3)})`);
      console.log(`- time: B/A median ×${v.wallRatio.toFixed(2)}`);
      break;
    }
    case 'noise': {
      const [a, b] = rest.map(readSide);
      if (a.section !== b.section) throw new Error('noise takes two runs of the same section');
      comparable(a, b);
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
    case 'heldout':
      if (rest[0] === 'make') await makeHeldout(stack(values.instance!, values.tempo!), rest[1], Number(rest[2] ?? 3));
      else console.log(spent().join('\n') || 'no held-out sets');
      break;
    case 'summary':
      for (const path of rest) console.log(JSON.stringify(summary(readRun(path).attempts), null, 1));
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
  heldout make <name> [count] | heldout list

options: --instance sugbench --set tune|<held-out set> --personas a,b --label local
         --seats <copies of each persona> --reps <rounds> (default: the section's size)
         --concurrency <generations at once> (default: the section's) --out <file> --margin <points>`);
  }
}

if (import.meta.main) await main();
