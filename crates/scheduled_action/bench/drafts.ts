// The routine drafting eval. Drafts each case in `cases.ts` on a local stack
// seeded with `workspace.ts`, through the routine editor's Draft it or an
// ordinary agent chat, then checks the draft, runs it once, has a blind model
// grade it, and reads its trace to split the time into phases. See README.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { SQL } from 'bun';

import { type ArmResult, bareArm, baseRoutine, catalog, deleteSession, draftArm, preflight } from './arms';
import { type Arm, CASES, type Case, type Context, type DraftResult } from './cases';
import { judge, passes } from './judge';
import {
  type Attempt,
  type Results,
  SUMMARY_HEADER,
  QUALITY_MARGIN,
  passedAll,
  summary,
  summaryRow,
  verdict,
  verdictLines,
} from './report';
import {
  type SavedRoutine,
  type Tokens,
  channelsMade,
  onEvents,
  reset,
  runCheck,
  save,
  withMentionNames,
  withReplies,
} from './runcheck';
import { SEEDED_IDS, index, savedDatabases, seed, setup } from './setup';
import {
  type Stack,
  call,
  currentHarness,
  exclusive,
  loadEnd,
  loadStart,
  login,
  restoreHarness,
  runningHarnesses,
  stack,
  useHarness,
} from './stack';
import { breakdown, draftSpans, sessionSpans } from './trace';
import { DATABASES, FIXTURE, JUDGE, OWNER, PERSON_KEYS, describe, email } from './workspace';

const TIMEZONE = 'America/New_York';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-5-5';
const STACK_OPTIONS = {
  instance: { type: 'string', default: 'drafting' },
  tempo: { type: 'string', default: process.env.TEMPO_URL ?? 'http://localhost:3200' },
} as const;

// ---------- one attempt ----------

/** A bare session asked about the name the case leaves open, instead of guessing. */
const askedRightly = (item: Case, arm: Arm, asked: boolean | undefined, reply: string | undefined) =>
  arm === 'bare' && item.asking !== undefined && asked === true && item.asking.test(reply ?? '');

/** The mechanical checks for `arm`; a bare agent that asks about an unmatched name passes. */
function checks(item: Case, arm: Arm, result: Pick<ArmResult, 'error' | 'draft' | 'asked' | 'reply'>, context: Context) {
  if (askedRightly(item, arm, result.asked, result.reply)) {
    return [{ says: 'asked which item the person meant instead of guessing', holds: true }];
  }
  if (result.error) return [{ says: 'answered', holds: false }];
  const draft = result.draft;
  if (!draft) return [{ says: 'answered with a draft', holds: false }];
  return item.expect
    .filter((expectation) => !expectation.arms || expectation.arms.includes(arm))
    .map((expectation) => ({ says: expectation.says, holds: expectation.holds(draft, context) }));
}

/** Names for the ids a draft may hold, for the judge. */
function glossary(ids: Record<string, string>) {
  const names = new Map<string, string>();
  for (const [name, id] of Object.entries(ids)) {
    names.set(id, FIXTURE[name] ? describe(name) : DATABASES.includes(name) ? `the database "${name}"` : name);
  }
  return names;
}

type Session = {
  at: Stack;
  db: SQL;
  tokens: Tokens;
  judgeToken: string;
  ids: Record<string, string>;
  keep: Set<string>;
  names: Map<string, string>;
  entries: Awaited<ReturnType<typeof catalog>>;
};

/**
 * Sign in and set the workspace up. `readOnly` skips setting it up, so
 * rereading results doesn't wait for a run holding the stack: it takes the
 * databases the last setup chose.
 */
async function open(instance: string, tempo: string, readOnly = false): Promise<Session> {
  const at = stack(instance, tempo);
  const saved = readOnly ? savedDatabases(instance) : undefined;
  if (readOnly && !saved) throw new Error(`${instance} has no setup here; run a draft on it first`);
  // Due dates written on a new day are task changes another eval's run check would see.
  const ids = saved
    ? { ...SEEDED_IDS, ...saved }
    : await exclusive(instance, 'setup', async () => {
        await index(at);
        return setup(at, TIMEZONE);
      });
  const tokens: Tokens = {};
  for (const person of PERSON_KEYS) tokens[person] = await login(at, email(person));
  const judgeToken = await login(at, email(JUDGE));
  const entries = await catalog(at, tokens[OWNER], TIMEZONE);
  await preflight(at, tokens[OWNER], entries);
  const databases = DATABASES.map((name) => ids[name]);
  return {
    at,
    db: new SQL(at.postgres),
    tokens,
    judgeToken,
    ids,
    keep: new Set(databases),
    names: glossary(ids),
    entries,
  };
}

/** The routine a step case changes, for the judge. */
const baseOf = (session: Session, item: Case) => (item.kind === 'routine' ? undefined : baseRoutine(item, session.entries));

/** Saved as the person would save it: event routines on, the rest off and run by hand. */
async function routineToRun(session: Session, result: ArmResult): Promise<SavedRoutine | undefined> {
  const { at, tokens } = session;
  const draft = result.draft as DraftResult;
  if (draft.outcome !== 'routine') return undefined;
  const events = onEvents(draft.trigger);
  if (!result.routine) return save(at, tokens[OWNER], draft, events);
  const routine = result.routine;
  if (events && !routine.enabled) {
    await call(`${at.harness}/scheduled-action/scheduled-actions/${routine.id}`, {
      method: 'PUT',
      token: tokens[OWNER],
      body: JSON.stringify({ name: routine.name, kind: routine.kind, trigger: routine.trigger, task: routine.task, enabled: true }),
    });
  }
  return routine;
}

async function attempt(
  session: Session,
  item: Case,
  arm: Arm,
  options: { label: string; round: number; model: string; runChecks: boolean; judge: boolean },
): Promise<Attempt> {
  const { at, db, tokens, ids, keep, entries } = session;
  const owner = tokens[OWNER];
  const held = await exclusive(at.instance, `${options.label} ${arm} ${item.id}`, async () => {
    await reset(at, db, tokens, keep);
    const build = currentHarness(at.instance);
    const before = loadStart();
    const result =
      arm === 'draft'
        ? await draftArm(at, owner, item, entries, options.model, TIMEZONE)
        : await bareArm(at, owner, item, entries, options.model);
    const load = loadEnd(before);
    const made = await channelsMade(db, new Date(result.startedAtMs));
    const context: Context = { ids, now: new Date(result.startedAtMs), timezone: TIMEZONE, made };
    const quality = checks(item, arm, result, context);
    // Before the run check, so a session still running can't act during it.
    if (result.sessionId) await deleteSession(at, owner, result.sessionId);
    let run: Attempt['run'];
    if (options.runChecks && item.run && !result.error && result.draft?.outcome === 'routine') {
      try {
        const routine = await routineToRun(session, result);
        if (routine) run = await runCheck(at, db, tokens, item, result.draft, routine, context);
      } catch (error) {
        run = {
          says: item.run.says,
          fired: item.run.fire(result.draft).type,
          holds: false,
          ms: 0,
          timedOut: false,
          effects: { runs: [], messages: [], tasks: [], notifications: [] },
          error: String(error).slice(0, 500),
        };
      }
    }
    await reset(at, db, tokens, keep);
    // The judge's model call goes through the stack's harness, so it holds the stack too.
    const grade =
      options.judge && result.draft && !result.error
        ? await judge(at, session.judgeToken, item, result.draft, result.reply, session.names, baseOf(session, item))
        : undefined;
    return { result, load, made, quality, run, build, grade };
  });
  const { result, load, made, quality, run, build, grade } = held;
  // Traces come from Tempo, not the stack, so they're read after the next
  // eval may have it.
  const window = { start: result.startedAtMs, end: result.startedAtMs + result.wallMs };
  const spans =
    arm === 'draft'
      ? await draftSpans(at, result.traceId)
      : { spans: await sessionSpans(at, result.traceId, result.sessionId ?? '', window), checks: [] };
  return {
    case: item.id,
    arm,
    label: options.label,
    round: options.round,
    traceId: result.traceId,
    startedAt: new Date(result.startedAtMs).toISOString(),
    wallMs: result.wallMs,
    status: result.status,
    error: result.error,
    draft: result.draft,
    reply: result.reply,
    turnMs: result.turnMs,
    asked: result.asked,
    made,
    quality,
    run,
    grade,
    breakdown: breakdown(spans, arm === 'bare' ? window : undefined),
    load,
    harness: build,
    sessionId: result.sessionId,
  };
}

type AttemptOptions = Parameters<typeof attempt>[3];

/**
 * One attempt, tried once more when the eval itself fails (a stack call
 * refused, a connection dropped); a second failure is kept as an error,
 * which fails every check and isn't timed.
 */
async function tryAttempt(session: Session, item: Case, arm: Arm, options: AttemptOptions): Promise<Attempt> {
  for (let tries = 1; ; tries++) {
    try {
      return await attempt(session, item, arm, options);
    } catch (error) {
      console.log(`${item.id} ${arm} #${options.round}: the eval failed: ${String(error).slice(0, 300)}`);
      if (tries < 2) {
        await Bun.sleep(10_000);
        continue;
      }
      return {
        case: item.id,
        arm,
        label: options.label,
        round: options.round,
        traceId: '',
        startedAt: new Date().toISOString(),
        wallMs: 0,
        error: `eval: ${String(error).slice(0, 500)}`,
        quality: [{ says: 'answered', holds: false }],
        load: loadEnd(loadStart()),
        harness: currentHarness(session.at.instance),
      };
    }
  }
}

const key = (item: { case: string; round: number }) => `${item.case}#${item.round}`;

/** The cases still to run in `round`, so resuming a run that stopped fills its gaps. */
function todo(results: Results, cases: Case[], round: number) {
  const have = new Set(results.attempts.map(key));
  return cases.filter((item) => !have.has(key({ case: item.id, round })));
}

/** The databases' ids, which `setup` picks per stack. */
const databaseIds = (session: Session) => Object.fromEntries(DATABASES.map((name) => [name, session.ids[name]]));

function line(item: Attempt) {
  const b = item.breakdown;
  const held = item.quality.filter((check) => check.holds).length;
  return [
    `${item.case} ${item.arm} #${item.round}`,
    `${(item.wallMs / 1000).toFixed(1)}s`,
    item.draft?.outcome ?? 'no draft',
    b ? `model ${(b.modelMs / 1000).toFixed(1)}s/${b.modelCalls}` : 'no trace',
    b ? `tools ${Object.values(b.tools).reduce((sum, tool) => sum + tool.calls, 0)}` : '',
    `checks ${held}/${item.quality.length}`,
    item.run ? `run ${item.run.holds ? 'ok' : item.run.timedOut ? 'timeout' : 'FAIL'}` : '',
    item.grade ? ('score' in item.grade ? `judge ${item.grade.score}` : 'judge error') : '',
    passedAll(item) ? 'PASS' : 'fail',
    `load ${item.load.load1[0].toFixed(0)}`,
  ]
    .filter(Boolean)
    .join('  ');
}

// ---------- commands ----------

const RUN_OPTIONS = {
  ...STACK_OPTIONS,
  arm: { type: 'string', default: 'draft' },
  rounds: { type: 'string', default: '3' },
  cases: { type: 'string' },
  model: { type: 'string', default: DEFAULT_MODEL },
  'no-run-checks': { type: 'boolean', default: false },
  'no-judge': { type: 'boolean', default: false },
} as const;

type RunValues = {
  arm?: string;
  rounds?: string;
  cases?: string;
  model?: string;
  'no-run-checks'?: boolean;
  'no-judge'?: boolean;
};

function selected(values: RunValues) {
  const wanted = values.cases ? new Set(values.cases.split(',')) : undefined;
  const cases = CASES.filter((item) => !wanted || wanted.has(item.id));
  if (wanted && cases.length !== wanted.size) {
    throw new Error(`unknown case in ${values.cases}; cases: ${CASES.map((item) => item.id).join(', ')}`);
  }
  return cases;
}

function arm(value: string | undefined): Arm {
  if (value !== 'draft' && value !== 'bare') throw new Error(`--arm is draft or bare, not ${value}`);
  return value;
}

function load(path: string, fresh: () => Results, append: boolean): Results {
  if (!append || !existsSync(path)) return fresh();
  return JSON.parse(readFileSync(path, 'utf8')) as Results;
}

const commit = () => Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD']).stdout.toString().trim();

/** Run the cases `rounds` times against whatever build the stack runs now. */
async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { ...RUN_OPTIONS, label: { type: 'string' }, out: { type: 'string' }, append: { type: 'boolean', default: false } },
  });
  if (!values.label || !values.out) throw new Error('run needs --label and --out');
  const which = arm(values.arm);
  const session = await open(values.instance, values.tempo);
  const out = resolve(values.out);
  const results = load(
    out,
    () => ({
      label: values.label as string,
      arm: which,
      model: values.model,
      commit: commit(),
      startedAt: new Date().toISOString(),
      stacks: runningHarnesses(),
      attempts: [],
    }),
    values.append,
  );
  if (results.label !== values.label || results.arm !== which || results.model !== values.model) {
    throw new Error(`${out} holds ${results.label} ${results.arm} on ${results.model}; write to another file`);
  }
  mkdirSync(dirname(out), { recursive: true });
  results.databases ??= databaseIds(session);
  console.log(`${values.instance} answers with ${currentHarness(values.instance) ?? 'the build it started with'}`);
  const last = Math.max(0, ...results.attempts.map((item) => item.round));
  // Round-robin over cases, so a slow stretch of the model's day spreads
  // across every case instead of landing on one.
  for (let round = 1; round <= last + Number(values.rounds); round++) {
    for (const item of todo(results, selected(values), round)) {
      const result = await tryAttempt(session, item, which, {
        label: results.label,
        round,
        model: values.model,
        runChecks: !values['no-run-checks'],
        judge: !values['no-judge'],
      });
      results.attempts.push(result);
      writeFileSync(out, `${JSON.stringify(results, null, 1)}\n`);
      console.log(line(result));
    }
  }
  console.log(`wrote ${out}`);
  await session.db.close();
}

/**
 * Two builds on interleaved rounds: A then B, then B then A, so the model's
 * drift over the day lands on both. Each segment swaps the stack's harness
 * to that build first. Writes `<label>.<arm>.json` per build into `--dir`.
 */
async function ab(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      ...RUN_OPTIONS,
      a: { type: 'string' },
      b: { type: 'string' },
      'a-bin': { type: 'string' },
      'b-bin': { type: 'string' },
      dir: { type: 'string' },
    },
  });
  if (!values.a || !values.b || !values['a-bin'] || !values['b-bin'] || !values.dir) {
    throw new Error('ab needs --a <label> --a-bin <dir> --b <label> --b-bin <dir> --dir <out dir>');
  }
  if (values.a === values.b) throw new Error('ab needs two labels: each side writes <label>.<arm>.json');
  const which = arm(values.arm);
  const sides = [
    { label: values.a, bin: values['a-bin'] },
    { label: values.b, bin: values['b-bin'] },
  ];
  const at = stack(values.instance, values.tempo);
  const files = sides.map((side) => join(resolve(values.dir as string), `${side.label}.${which}.json`));
  mkdirSync(resolve(values.dir), { recursive: true });
  const all = sides.map((side, index) =>
    load(
      files[index],
      () => ({
        label: side.label,
        arm: which,
        model: values.model,
        commit: commit(),
        startedAt: new Date().toISOString(),
        stacks: runningHarnesses(),
        attempts: [],
      }),
      true,
    ),
  );
  all.forEach((results, index) => {
    if (results.label !== sides[index].label || results.arm !== which || results.model !== values.model) {
      throw new Error(`${files[index]} holds ${results.label} ${results.arm} on ${results.model}; use another --dir`);
    }
  });
  // Put back whatever the stack ran before, so a later `run` measures what it says.
  const before = currentHarness(at.instance);
  try {
    // `--rounds` is the total, so running the same command again finishes a stopped run.
    for (let round = 1; round <= Number(values.rounds); round++) {
      const order = round % 2 === 1 ? [0, 1] : [1, 0];
      for (const index of order) {
        const cases = todo(all[index], selected(values), round);
        if (!cases.length) continue;
        console.log(`round ${round}: ${sides[index].label} (${sides[index].bin})`);
        // The segment holds the stack, so no other eval drafts on this build
        // under its own label.
        await exclusive(at.instance, `ab ${sides[index].label}`, async () => {
          await useHarness(at, sides[index].bin);
          const session = await open(values.instance as string, values.tempo as string);
          all[index].databases ??= databaseIds(session);
          for (const item of cases) {
            const result = await tryAttempt(session, item, which, {
              label: sides[index].label,
              round,
              model: values.model as string,
              runChecks: !values['no-run-checks'],
              judge: !values['no-judge'],
            });
            all[index].attempts.push(result);
            writeFileSync(files[index], `${JSON.stringify(all[index], null, 1)}\n`);
            console.log(line(result));
          }
          await session.db.close();
        });
      }
    }
  } finally {
    await exclusive(at.instance, 'ab putting the harness back', () => restoreHarness(at, before));
    console.log(`${at.instance} answers with ${before ?? 'the build it started with'} again`);
  }
  console.log(`wrote ${files.join(' and ')}`);
}

/** Summaries per file, per case, and the verdict of the last file against the first. */
function compare(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: 'string' }, margin: { type: 'string' } },
  });
  const files = positionals.map((path) => JSON.parse(readFileSync(path, 'utf8')) as Results);
  if (!files.length) throw new Error('compare needs results files');
  const lines: string[] = ['Seconds; quality is the share of drafts passing every mechanical and run check.', ''];
  lines.push(...SUMMARY_HEADER);
  for (const file of files) lines.push(summaryRow(`${file.label} ${file.arm}`, summary(file.attempts)));
  lines.push('', '| case | build | n | median | worst | quality | judge |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const item of CASES) {
    for (const file of files) {
      const attempts = file.attempts.filter((attempt) => attempt.case === item.id);
      if (!attempts.length) continue;
      const row = summary(attempts);
      lines.push(
        `| ${item.id} | ${file.label} ${file.arm} | ${row.attempts} | ${(row.median / 1000).toFixed(1)} | ${(row.worst / 1000).toFixed(1)} | ${Math.round(row.quality * 100)}% | ${Number.isNaN(row.judge) ? '–' : row.judge.toFixed(1)} |`,
      );
    }
  }
  if (files.length >= 2) {
    const first = files[0];
    const last = files[files.length - 1];
    lines.push('', `### ${last.label} against ${first.label}`, '');
    if (values.margin === undefined && first.arm !== last.arm) {
      throw new Error(`${first.label} is the ${first.arm} arm and ${last.label} the ${last.arm} arm: pass --margin`);
    }
    const margin = values.margin === undefined ? QUALITY_MARGIN[first.arm] : Number(values.margin);
    lines.push(...verdictLines(verdict(first.attempts, last.attempts, margin)));
  }
  const report = `${lines.join('\n')}\n`;
  if (values.out) writeFileSync(values.out, report);
  console.log(report);
}

/**
 * The same build against itself, on interleaved rounds: how far time and
 * quality move with nothing changed, and so the margin `compare` may use.
 */
function noise(args: string[]) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const [a, b] = positionals.map((path) => JSON.parse(readFileSync(path, 'utf8')) as Results);
  if (!a || !b) throw new Error('noise needs two results files of the same build');
  const v = verdict(a.attempts, b.attempts, 0);
  // Half the interval's width: how far the share moves either way by chance.
  // The observed move is one draw of that chance, so it isn't added on.
  const half = (v.qualityInterval[1] - v.qualityInterval[0]) / 2;
  console.log(verdictLines(v).slice(2).join('\n'));
  console.log(`quality moves by ±${Math.round(half * 100)}% with nothing changed (95%, ${v.pairs} pairs): the margin`);
  console.log(`time: B/A within ×${v.timeInterval[0].toFixed(2)}–×${v.timeInterval[1].toFixed(2)}`);
}

/** Check results files' drafts again, read their traces again, or grade them again. */
async function reread(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { ...STACK_OPTIONS, traces: { type: 'boolean', default: false }, judge: { type: 'boolean', default: false } },
  });
  const session = values.traces || values.judge ? await open(values.instance, values.tempo, true) : undefined;
  // Agent steps' replies, for results saved before run checks read them.
  let db: SQL | undefined;
  for (const path of positionals) {
    const results = JSON.parse(readFileSync(path, 'utf8')) as Results;
    const databases = results.databases ?? savedDatabases(values.instance);
    if (!databases) throw new Error(`${path} doesn't say which databases it used, and ${values.instance} has no setup here`);
    const ids = { ...SEEDED_IDS, ...databases };
    for (const item of results.attempts) {
      const found = CASES.find((candidate) => candidate.id === item.case);
      if (!found) continue;
      const context: Context = { ids, now: new Date(item.startedAt), timezone: TIMEZONE, made: item.made ?? [] };
      item.quality = checks(found, item.arm, item, context);
      if (item.run?.effects.runs.some((run) => run.reply === undefined && JSON.stringify(run.result).includes('"type":"agent"'))) {
        db ??= new SQL(stack(values.instance, values.tempo).postgres);
        item.run.effects.runs = await withReplies(db, item.run.effects.runs);
      }
      if (item.run?.effects.messages.some((message) => message.text.includes('<m-document-mention>'))) {
        db ??= new SQL(stack(values.instance, values.tempo).postgres);
        const texts = await withMentionNames(db, item.run.effects.messages.map((message) => message.text));
        item.run.effects.messages.forEach((message, index) => {
          message.text = texts[index];
        });
      }
      if (item.run && found.run) item.run.holds = !item.run.error && found.run.holds(item.run.effects, context);
      if (session && values.traces) {
        const window = { start: Date.parse(item.startedAt), end: Date.parse(item.startedAt) + item.wallMs };
        const spans =
          item.arm === 'draft'
            ? await draftSpans(session.at, item.traceId)
            : { spans: await sessionSpans(session.at, item.traceId, item.sessionId ?? '', window), checks: [] };
        item.breakdown = breakdown(spans, item.arm === 'bare' ? window : undefined) ?? item.breakdown;
      }
      if (session && values.judge && item.draft && !item.error) {
        item.grade = await judge(
          session.at,
          session.judgeToken,
          found,
          item.draft,
          item.reply,
          // The ids this file's drafts saw, which may predate the stack's setup.
          glossary(ids),
          baseOf(session, found),
        );
      }
    }
    writeFileSync(path, `${JSON.stringify(results, null, 1)}\n`);
    console.log(`reread ${results.attempts.length} attempts in ${path}`);
  }
  await session?.db.close();
  await db?.close();
}

/**
 * How often the judge agrees with hand grades: `grades.json` maps
 * `<label>:<arm>:<case>#<round>` to a score from 1 to 5 given with the rubric.
 */
function calibrate(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { grades: { type: 'string' } } });
  if (!values.grades) throw new Error('calibrate needs --grades <grades.json>');
  const grades = JSON.parse(readFileSync(values.grades, 'utf8')) as Record<string, number>;
  const rows: { key: string; hand: number; judge: number }[] = [];
  for (const path of positionals) {
    const results = JSON.parse(readFileSync(path, 'utf8')) as Results;
    for (const item of results.attempts) {
      const key = `${item.label}:${item.arm}:${item.case}#${item.round}`;
      if (grades[key] === undefined || !item.grade || !('score' in item.grade)) continue;
      rows.push({ key, hand: grades[key], judge: item.grade.score });
    }
  }
  const exact = rows.filter((row) => row.hand === row.judge).length;
  const near = rows.filter((row) => Math.abs(row.hand - row.judge) <= 1).length;
  const same = rows.filter((row) => (row.hand >= 4) === passes({ score: row.judge, problems: [] })).length;
  console.log(`${rows.length} drafts graded by hand and by the judge`);
  console.log(`same score ${exact}, within one ${near}, same keep-or-fix call ${same} (${Math.round((same / rows.length) * 100)}%)`);
  for (const row of rows.filter((row) => row.hand !== row.judge)) console.log(`  ${row.key}: hand ${row.hand}, judge ${row.judge}`);
}

async function seedCommand(args: string[]) {
  const { values } = parseArgs({ args, options: { ...STACK_OPTIONS } });
  const at = stack(values.instance, values.tempo);
  // Seeding resets the workspace under any draft running on it.
  const ids = await exclusive(values.instance, 'seed', async () => {
    seed(values.instance);
    await index(at, true);
    return setup(at, TIMEZONE, true);
  });
  console.log(`seeded ${Object.keys(ids).length} named items on ${values.instance}`);
}

async function harness(args: string[]) {
  const { values } = parseArgs({ args, options: { ...STACK_OPTIONS, bin: { type: 'string' } } });
  if (!values.bin) throw new Error('harness needs --bin <dir holding agent_harness_service>');
  const at = stack(values.instance, values.tempo);
  await exclusive(at.instance, `switching to ${values.bin}`, () => useHarness(at, values.bin as string));
  console.log(`${values.instance} now answers with ${values.bin}`);
}

const USAGE = `usage:
  drafts.ts seed [--instance drafting]
      seed the workspace (again resets it), index it for search, set due dates and databases
  drafts.ts run --label <build> --out <file.json> [--arm draft|bare] [--rounds 3]
      [--cases a,b] [--model m] [--no-run-checks] [--no-judge] [--append]
  drafts.ts ab --a <label> --a-bin <dir> --b <label> --b-bin <dir> --dir <out>
      [--arm draft|bare] [--rounds 3] [...run options]
      interleaved rounds of two harness builds, swapping the stack's harness;
      --rounds is the total, so the same command again finishes a stopped run
  drafts.ts compare <a.json> [<b.json>...] [--margin <share>] [--out report.md]
      the margin defaults to the arm's measured noise (QUALITY_MARGIN)
  drafts.ts noise <a.json> <b.json>    one build against itself: the margin to use
  drafts.ts reread [--traces] [--judge] <results.json>...
  drafts.ts calibrate --grades <grades.json> <results.json>...
  drafts.ts harness --bin <dir>    point the stack's harness at a build`;

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => unknown> = {
  seed: seedCommand,
  run,
  ab,
  compare,
  noise,
  reread,
  calibrate,
  harness,
};
if (!command || !commands[command]) {
  console.error(USAGE);
  process.exit(2);
}
await commands[command](rest);
