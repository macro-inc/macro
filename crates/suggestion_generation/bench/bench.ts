// The suggestions bench: generates suggestions for synthetic personas on a
// local stack, has a model mark them against each persona's answer key, and
// scores each section with one number you can hill climb. See README.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { type Stack, call, exclusive, login, sdk, searchIndexer, stack } from '../../scheduled_action/bench/stack';
import { catalogDrift } from './catalog';
import { makeHeldout, spend, spent } from './heldout';
import { judgeCost, judgeFeed, judgeRoutines, seedGrader } from './judge';
import { seedId } from '../../scheduled_action/bench/setup';
import { type Persona, type Variant, ownerEmail, personas, scenarioName } from './personas';
import { lines as reportLines } from './report';
import { CACHE, type Trigger, generate, prepare } from './run';
import { type Attempt, type RunFile, type Section, noiseMargin, scoreFeed, scoreRoutines, summary, verdict } from './score';
import { startStub, stopStub, stubDir, writeFlags } from './stub';

type SectionSpec = {
  /** What it measures, for the report. */
  about: string;
  variant: Variant;
  trigger: Trigger;
  flags: Record<string, boolean>;
  /** Whether its sessions search the workspace, so seeded items need indexing. */
  search: boolean;
};

export const SECTIONS: Record<Section, SectionSpec> = {
  routines: {
    about: 'Routine suggestions at signup: the onboarding generation with only routine suggestions on, for a person whose mailbox is all Macro has.',
    variant: 'signup',
    trigger: 'onboarding',
    flags: { 'enable-routine-suggestions': true },
    search: false,
  },
  feed: {
    about: 'The Suggestions feed: a "fresh suggestions" generation with only suggestions on, over a workspace in use for weeks.',
    variant: 'full',
    trigger: 'manual',
    flags: { 'enable-suggestions': true },
    search: true,
  },
};

/**
 * What two runs of main against main moved each section's score by, at the
 * default size (3 personas × 3 reps): a smaller difference is noise. Measured
 * with `noise` (README, Baseline); a run of another size needs its own.
 */
export const MARGINS: Record<Section, number> = { routines: 12, feed: 12 };

const RUNS = join(CACHE, 'runs');

const OPTIONS = {
  instance: { type: 'string', default: 'sugbench' },
  tempo: { type: 'string', default: process.env.TEMPO_URL ?? 'http://localhost:3200' },
  reps: { type: 'string', default: '3' },
  set: { type: 'string', default: 'tune' },
  personas: { type: 'string' },
  label: { type: 'string', default: 'local' },
  out: { type: 'string' },
  concurrency: { type: 'string', default: '3' },
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
async function indexAll(at: Stack, people: Persona[], variant: Variant) {
  const indexer = searchIndexer(at);
  const headers = { 'x-internal-auth-key': indexer.key };
  for (const kind of ['documents', 'channels', 'projects', 'emails']) {
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
    const id = seedId(scenarioName(persona, variant), 'document', key);
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

async function judgeAndScore(at: Stack, section: Section, persona: Persona, attempt: Attempt) {
  const started = new Date();
  try {
    if (section === 'routines') {
      attempt.routineMarks = await judgeRoutines(at, persona, attempt.generation);
      attempt.score = scoreRoutines(attempt.generation, attempt.routineMarks, persona.routinesTruth!);
    } else {
      attempt.feedMarks = await judgeFeed(at, persona, attempt.generation);
      attempt.score = scoreFeed(attempt.generation, attempt.feedMarks, persona.feedTruth!);
    }
  } catch (error) {
    attempt.benchError = `judge: ${String(error).slice(0, 300)}`;
  }
  attempt.judgeUsd = await judgeCost(at, new Date(started.getTime() - 1000), new Date(Date.now() + 5000)).catch(() => 0);
}

/** Run `section` for every chosen persona, `reps` times, and write the run file as it goes. */
async function runSection(section: Section, values: Record<string, string | undefined>): Promise<string> {
  const spec = SECTIONS[section];
  const at = stack(values.instance!, values.tempo!);
  const drift = catalogDrift();
  if (drift.length) throw new Error(drift.join('\n'));
  const set = values.set!;
  let people = personas(set);
  if (values.personas) {
    const chosen = values.personas.split(',');
    people = people.filter((persona) => chosen.includes(persona.name));
  }
  const truthKey = section === 'routines' ? 'routinesTruth' : 'feedTruth';
  people = people.filter((persona) => persona[truthKey]);
  if (!people.length) throw new Error(`no persona in set ${set} has a ${section} answer key`);
  if (set !== 'tune') spend(set, section, values.label!);
  const reps = Number(values.reps);
  const concurrency = Math.max(1, Number(values.concurrency));
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
    flags: spec.flags,
    attempts: [],
  };
  const save = () => writeFileSync(out, `${JSON.stringify(run, null, 1)}\n`);
  await exclusive(at.instance, `suggestions bench ${section}`, async () => {
    startStub(at.instance);
    await setFlags(at.instance, spec.flags);
    seedGrader(at.instance);
    for (let rep = 1; rep <= reps; rep++) {
      const now = Date.now();
      for (const persona of people) await prepare(at, persona, spec.variant, now, join(dir, `${persona.name}-${rep}`));
      if (spec.search) await indexAll(at, people, spec.variant);
      for (let i = 0; i < people.length; i += concurrency) {
        const batch = people.slice(i, i + concurrency);
        await Promise.all(
          batch.map(async (persona) => {
            const base = join(dir, `${persona.name}-${rep}`);
            const generation = await generate(at, persona, spec.variant, spec.trigger, now, base);
            const attempt: Attempt = { section, label: run.label, persona: persona.name, heldout: persona.heldout, rep, generation, judgeUsd: 0 };
            if (generation.error) attempt.benchError = `generation: ${generation.error}`;
            else await judgeAndScore(at, section, persona, attempt);
            run.attempts.push(attempt);
            save();
            const s = attempt.score;
            console.log(
              `${section} ${persona.name} #${rep}: ${attempt.benchError ?? `score ${s!.score.toFixed(0)} (found ${s!.found}/${s!.needs}, bad ${s!.bad}, ${s!.suggestions} suggested), ${generation.status}, ${((generation.wallMs ?? 0) / 1000).toFixed(0)}s, $${generation.cost.usd.toFixed(3)}`}`,
            );
          }),
        );
      }
    }
  });
  save();
  console.log(`\n${reportLines([run]).join('\n')}\n\nwrote ${out}`);
  return out;
}

const readRun = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as RunFile;

/** Judge and score a run again, without generating: for a changed judge or answer key. */
async function rejudge(path: string, values: Record<string, string | undefined>) {
  const run = readRun(path);
  const at = stack(values.instance!, values.tempo!);
  seedGrader(at.instance);
  const people = new Map(personas(run.set).map((persona) => [persona.name, persona]));
  for (const attempt of run.attempts) {
    if (attempt.generation.error) continue;
    attempt.benchError = undefined;
    await judgeAndScore(at, run.section, people.get(attempt.persona)!, attempt);
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
      console.log(reportLines(rest.map(readRun)).join('\n'));
      break;
    case 'compare': {
      const [a, b] = rest.map(readRun);
      if (a.section !== b.section) throw new Error('compare two runs of the same section');
      const margin = values.margin ? Number(values.margin) : MARGINS[a.section];
      const v = verdict(a.attempts, b.attempts, margin);
      console.log(`${a.section}: ${a.label} → ${b.label}\n\n**${v.verdict.toUpperCase()}**: ${v.why}.`);
      console.log(`- score: ${v.delta >= 0 ? '+' : ''}${v.delta.toFixed(1)} (95% ${v.deltaInterval[0].toFixed(1)} to ${v.deltaInterval[1].toFixed(1)}) over ${v.pairs} pairs; margin ${v.margin}`);
      for (const [name, [x, y]] of Object.entries(v.parts)) console.log(`- ${name}: ${x.toFixed(2)} → ${y.toFixed(2)}`);
      console.log(`- cost per generation: $${v.usd[0].toFixed(3)} → $${v.usd[1].toFixed(3)} (difference 95% ${v.usdInterval[0].toFixed(3)} to ${v.usdInterval[1].toFixed(3)})`);
      console.log(`- time: B/A median ×${v.wallRatio.toFixed(2)} (95% ${v.wallInterval[0].toFixed(2)}–${v.wallInterval[1].toFixed(2)})`);
      break;
    }
    case 'noise': {
      const [a, b] = rest.map(readRun);
      const n = noiseMargin(a.attempts, b.attempts);
      console.log(`${a.section}: ${n.pairs} pairs of the same build moved ${n.delta.toFixed(1)} (95% ${n.interval[0].toFixed(1)} to ${n.interval[1].toFixed(1)}): margin ${n.margin.toFixed(1)}`);
      break;
    }
    case 'rejudge':
      for (const path of rest) await rejudge(path, values);
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
  rejudge <run.json…>  judge and score again without generating
  stub [stop]          start or stop the stand-in
  heldout make <name> [count] | heldout list

options: --instance sugbench --reps 3 --set tune|<held-out set> --personas a,b
         --label local --concurrency 3 --out <file> --margin <points>`);
  }
}

await main();
