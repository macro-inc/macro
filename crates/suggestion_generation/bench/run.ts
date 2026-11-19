// One generation for one persona: seed a clean copy, start the generation
// the way the app does, watch it to the end while keeping its sessions'
// transcripts (they are deleted with the sessions), and read back what it
// wrote, how long it took and what it cost.

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { SQL } from 'bun';

import { type Stack, call, login } from '../../scheduled_action/bench/stack';
import { type Persona, type Variant, ownerEmail, recentMessages, scenario, scenarioName } from './personas';
import { clearInbox, writeInbox } from './stub';

const REPO = resolve(import.meta.dir, '../../..');
export const CACHE = join(homedir(), '.cache/suggestions-bench');

export type Trigger = 'onboarding' | 'manual';

/** A routine suggestion as stored. */
export type RoutineRow = {
  id: string;
  catalog_key: string | null;
  knob_values: Record<string, unknown>;
  routine: Record<string, unknown> | null;
  reason: string;
  keep_probability: number;
  surfaces: string[];
  created_at: string;
  session_id: string;
};

/** A feed card as stored, with what it points at. */
export type CardRow = {
  id: string;
  kind: 'prompt' | 'entity' | 'routine';
  title: string;
  summary: string;
  importance: number;
  categories: string[];
  state: string;
  created_at: string;
  action: string | null;
  prompt: string | null;
  run_mode: string | null;
  draft_preview: string | null;
  targets: { role: string; entity_type: string; entity_id: string }[];
};

export type SessionRow = {
  session_id: string;
  kind: string;
  surfaces: string[];
  ending: string | null;
  opened_at: string;
  ended_at: string | null;
};

export type Cost = { usd: number; inputTokens: number; outputTokens: number; calls: number; models: Record<string, number> };

/** What one generation did. */
export type Generation = {
  persona: string;
  variant: Variant;
  trigger: Trigger;
  /** When the bench asked for it: the persona's "now", which the judge reads too. */
  now: number;
  timezone: string;
  generationId?: string;
  status?: string;
  traceId?: string | null;
  sessions: SessionRow[];
  routines: RoutineRow[];
  cards: CardRow[];
  /** From the request to the first suggestion it wrote, and to the generation's end. */
  firstMs?: number;
  wallMs?: number;
  cost: Cost;
  /** The transcripts, one JSON line per log entry. */
  transcript?: string;
  error?: string;
  /** The build failed, not the bench: the start was refused with a server error, or the generation outran the deadline. Scored 0. */
  buildFailed?: boolean;
};

export const userId = (email: string) => `macro|${email}`;

/**
 * Seed a variant's scenario with the seed CLI. `apply` replaces every row
 * carrying the scenario's id marker. Each person signs up through the signup
 * webhook on their first seed, as anyone does, and keeps that account after:
 * signing up again on every attempt would pile up what a signup makes (a
 * support channel, a billing customer) and race it against the generation.
 * What a generation leaves behind is `forgetWork`'s to clear.
 */
export async function seed(instance: string, persona: Persona, variant: Variant, now: number, log: string) {
  const dir = join(CACHE, instance, 'scenarios');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${scenarioName(persona, variant)}.json`);
  const spec = scenario(persona, variant, now) as { users: Record<string, { email: string }> };
  writeFileSync(path, `${JSON.stringify(spec, null, 1)}\n`);
  // Not spawnSync: other personas' generations are being watched meanwhile.
  const child = Bun.spawn(['just', 'seed-scenario', '--instance', instance, 'apply', '--file', path], {
    cwd: REPO,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const output = stdout + stderr;
  writeFileSync(log, output, { flag: 'a' });
  if (exitCode !== 0) throw new Error(`seed-scenario apply ${scenarioName(persona, variant)} exited with ${exitCode}; see ${log}`);
  // The seed CLI goes on without a login when the signup webhook refuses one
  // (it allows 50 signups an hour from one address); say so here, not as a
  // failed login later. Only the owner logs in; a refused colleague is a
  // seeded user without a login, which no generation needs.
  const owner = Object.entries(spec.users).find(([, user]) => user.email === ownerEmail(persona, variant))?.[0];
  const refused = output.match(new RegExp(`user \`${owner}\`: FusionAuth account creation failed.*`))?.[0];
  if (refused) throw new Error(`seeding ${scenarioName(persona, variant)}: ${refused}; see ${log}`);
}

/**
 * How long a first signup's sample content, and an earlier generation's
 * sessions, may take to settle: a session of a generation whose process died
 * is ended by the harness's sweep after 20 minutes, a failed delete retried
 * after 5.
 */
const SIGNUP_SETTLE_MS = 90_000;
const RUNNING_SETTLE_MS = 25 * 60_000;

/** Poll `ready` once a second until it holds, or throw after `limitMs`. */
async function until(what: string, limitMs: number, ready: () => Promise<boolean>) {
  for (const start = Date.now(); !(await ready()); await Bun.sleep(1000)) {
    if (Date.now() - start > limitMs) throw new Error(`${what} after ${limitMs / 1000} s`);
  }
}

/**
 * The tables a generation writes a person's rows to: every suggestion and
 * routine suggestion table keyed by `user_id` from "User" (their child
 * tables cascade from them), read from the catalog so a new one is covered.
 */
const WORK_TABLES = `SELECT DISTINCT c.conrelid::regclass::text AS name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
 WHERE c.contype = 'f' AND c.confrelid = '"User"'::regclass AND a.attname = 'user_id'
   AND c.conrelid::regclass::text ~ '^(routine_)?suggestion'`;

/** The email drafts of a person's mailboxes: personas seed none, so any is a session's. */
const DRAFTS = `FROM email_messages WHERE is_draft AND link_id IN (SELECT id FROM email_links WHERE macro_id = $1)`;

async function workTables(db: SQL): Promise<string[]> {
  const tables = (await db.unsafe(WORK_TABLES)).map((row: { name: string }) => row.name);
  for (const table of ['suggestion', 'routine_suggestion', 'suggestion_generation']) {
    if (!tables.includes(table)) throw new Error(`no ${table} among the tables to clear: ${tables.join(', ')}`);
  }
  return tables;
}

/** Delete everything an earlier generation left for `user`: suggestions, routine suggestions, generations, drafts. */
export async function forgetWork(db: SQL, user: string) {
  // An abandoned session may still exist, and only its row keeps it to the
  // narrow generation scope: deleting the row would lift that.
  const [{ abandoned }] = await db.unsafe(
    `SELECT count(*)::int AS abandoned FROM suggestion_generation_session WHERE user_id = $1 AND cleanup = 'abandoned'`,
    [user],
  );
  if (abandoned) throw new Error(`${user} has ${abandoned} abandoned generation sessions; delete their agent sessions, then their suggestion_generation rows, before running again`);
  const tables = await workTables(db);
  await db.begin(async (tx) => {
    for (const table of tables) await tx.unsafe(`DELETE FROM ${table} WHERE user_id = $1`, [user]);
    await tx.unsafe(`DELETE ${DRAFTS}`, [user]);
  });
}

/** Check `user` has none of a generation's leftovers, so no run reads another's work. */
export async function assertClean(db: SQL, user: string) {
  for (const [what, from] of [...(await workTables(db)).map((table) => [table, `FROM ${table} WHERE user_id = $1`]), ['draft', DRAFTS]]) {
    const [{ count }] = await db.unsafe(`SELECT count(*)::int AS count ${from}`, [user]);
    if (count !== 0) throw new Error(`${user} still has ${count} ${what} rows after seeding`);
  }
}

const SESSIONS = `SELECT s.session_id::text, s.kind, s.surfaces, s.ending, s.opened_at::text, s.ended_at::text
  FROM suggestion_generation_session s WHERE s.generation_id = $1 ORDER BY s.opened_at`;

/** Keeps every log line of the generation's sessions while they exist. */
async function capture(db: SQL, generation: string, seen: Map<string, unknown>) {
  const rows = await db.unsafe(
    `SELECT l.id::text, l.agent_session_id::text AS session, l.direction, l.content, l.created_at::text
       FROM agent_session_log l
       JOIN suggestion_generation_session s ON s.session_id = l.agent_session_id
      WHERE s.generation_id = $1`,
    [generation],
  );
  for (const row of rows) seen.set(row.id, row);
}

async function costOf(db: SQL, user: string, from: Date, to: Date): Promise<Cost> {
  const rows = await db.unsafe(
    `SELECT model, count(*)::int AS calls, coalesce(sum(input_tokens), 0)::bigint AS input,
            coalesce(sum(output_tokens), 0)::bigint AS output, coalesce(sum(total), 0)::float8 AS usd
       FROM ai_usage WHERE user_id = $1 AND created_at BETWEEN $2 AND $3 GROUP BY model`,
    [user, from, to],
  );
  const cost: Cost = { usd: 0, inputTokens: 0, outputTokens: 0, calls: 0, models: {} };
  for (const row of rows) {
    cost.usd += row.usd;
    cost.inputTokens += Number(row.input);
    cost.outputTokens += Number(row.output);
    cost.calls += row.calls;
    cost.models[row.model] = (cost.models[row.model] ?? 0) + row.usd;
  }
  return cost;
}

async function cardsOf(db: SQL, user: string): Promise<CardRow[]> {
  return (await db.unsafe(
    `SELECT s.id::text, s.kind, s.title, s.summary, s.importance, s.categories, s.state, s.created_at::text,
            e.action, p.prompt, p.run_mode, e.draft_preview,
            coalesce((SELECT json_agg(json_build_object('role', t.role, 'entity_type', t.entity_type, 'entity_id', t.entity_id)
                                ORDER BY t.role, t.position)
                        FROM suggestion_target t WHERE t.suggestion_id = s.id), '[]'::json) AS targets
       FROM suggestion s
       LEFT JOIN suggestion_entity e ON e.suggestion_id = s.id
       LEFT JOIN suggestion_prompt p ON p.suggestion_id = s.id
      WHERE s.user_id = $1 ORDER BY s.importance DESC, s.created_at`,
    [user],
  )) as CardRow[];
}

async function routinesOf(db: SQL, user: string): Promise<RoutineRow[]> {
  return (await db.unsafe(
    `SELECT id::text, catalog_key, knob_values, routine, reason, keep_probability, surfaces, created_at::text, session_id::text
       FROM routine_suggestion WHERE user_id = $1 AND retired_at IS NULL ORDER BY created_at`,
    [user],
  )) as RoutineRow[];
}

/** Longest the bench waits for a generation: past the longest session's timeout and its cleanup. */
const DEADLINE_MS: Record<Trigger, number> = { onboarding: 12 * 60_000, manual: 25 * 60_000 };

/** Seed `persona` clean as it is at `now`, and check nothing of an earlier run is left. */
export async function prepare(at: Stack, persona: Persona, variant: Variant, now: number, out: string) {
  const db = new SQL(at.postgres);
  try {
    const email = ownerEmail(persona, variant);
    const user = userId(email);
    // A generation an earlier attempt gave up on may still be running as the
    // person, or its sessions still waiting for the harness to end or delete
    // them; clearing their rows would hide them from that cleanup.
    await until(`${user} still has generation sessions open`, RUNNING_SETTLE_MS, async () => {
      const [{ open }] = await db.unsafe(
        `SELECT (SELECT count(*) FROM suggestion_generation WHERE user_id = $1 AND status = 'generating')
              + (SELECT count(*) FROM suggestion_generation_session WHERE user_id = $1 AND cleanup IN ('open', 'stopping'))
              AS open`,
        [user],
      );
      return Number(open) === 0;
    });
    await seed(at.instance, persona, variant, now, `${out}.seed.log`);
    // A first signup's sample documents and then its support channel land
    // seconds after the seed: wait for the channel, so the generation sees
    // what later attempts will. A person signed up before has it already.
    await until(`${user}'s signup content never arrived`, SIGNUP_SETTLE_MS, async () => {
      const [{ channels }] = await db.unsafe(
        `SELECT count(*)::int AS channels FROM comms_channels WHERE owner_id = $1 AND name LIKE 'Macro Support x %'`,
        [user],
      );
      return channels > 0;
    });
    await forgetWork(db, user);
    await assertClean(db, user);
  } finally {
    await db.close();
  }
}

/**
 * Start the generation of `persona`, seeded by `prepare` at `now`, and wait
 * for it to end. The caller holds the stack and has written the flags.
 */
export async function generate(
  at: Stack,
  persona: Persona,
  variant: Variant,
  trigger: Trigger,
  now: number,
  out: string,
): Promise<Generation> {
  const email = ownerEmail(persona, variant);
  const user = userId(email);
  const timezone = persona.inbox.timezone;
  const result: Generation = {
    persona: persona.name,
    variant,
    trigger,
    now,
    timezone,
    sessions: [],
    routines: [],
    cards: [],
    cost: { usd: 0, inputTokens: 0, outputTokens: 0, calls: 0, models: {} },
  };
  const db = new SQL(at.postgres);
  const transcript = new Map<string, unknown>();
  let asked: number | undefined;
  try {
    writeInbox(at.instance, email, recentMessages(persona, variant, now));
    const token = await login(at, email);
    const route = trigger === 'onboarding' ? 'generate' : 'regenerate';
    asked = Date.now();
    const start = asked;
    await call(`${at.harness}/scheduled-action/suggestions/${route}?timezone=${encodeURIComponent(timezone)}`, {
      method: 'POST',
      token,
    }).catch((error) => {
      if (/ 5\d\d: /.test(String(error))) result.buildFailed = true;
      throw error;
    });
    const [row] = await db.unsafe(
      `SELECT id::text FROM suggestion_generation WHERE user_id = $1 AND trigger = $2 ORDER BY started_at DESC LIMIT 1`,
      [user, trigger],
    );
    if (!row) throw new Error(`no ${trigger} generation started; is a flag on for ${email}?`);
    result.generationId = row.id;
    let ended: { status: string; finished_at: Date | null; trace_id: string | null };
    for (;;) {
      await capture(db, row.id, transcript);
      if (result.firstMs === undefined) {
        const [first] = await db.unsafe(
          `SELECT least((SELECT min(created_at) FROM suggestion WHERE user_id = $1),
                        (SELECT min(created_at) FROM routine_suggestion WHERE user_id = $1)) AS at`,
          [user],
        );
        if (first?.at) result.firstMs = new Date(first.at).getTime() - start;
      }
      const [state] = await db.unsafe(
        `SELECT status, finished_at, trace_id FROM suggestion_generation WHERE id = $1`,
        [row.id],
      );
      if (state.status !== 'generating') {
        ended = state;
        break;
      }
      if (Date.now() - start > DEADLINE_MS[trigger]) {
        result.buildFailed = true;
        throw new Error(`generation still running after ${DEADLINE_MS[trigger] / 60_000} minutes`);
      }
      await Bun.sleep(1500);
    }
    result.status = ended.status;
    result.traceId = ended.trace_id;
    result.wallMs = (ended.finished_at ? new Date(ended.finished_at).getTime() : Date.now()) - start;
    result.sessions = (await db.unsafe(SESSIONS, [row.id])) as SessionRow[];
    // A session whose first prompt the harness didn't take in time never ran:
    // that is the stack falling behind, not the generation's work.
    const undelivered = result.sessions.filter((session) => session.ending === 'delivery_unknown').length;
    if (undelivered) result.error = `${undelivered} of ${result.sessions.length} sessions never got their prompt (delivery_unknown): the stack is overloaded; run fewer at once (--concurrency)`;
    result.routines = await routinesOf(db, user);
    result.cards = await cardsOf(db, user);
    // Usage rows land as each model call settles: give the last ones a moment.
    await Bun.sleep(5000);
    result.cost = await costOf(db, user, new Date(start - 1000), new Date());
  } catch (error) {
    result.error = String(error).slice(0, 500);
    // A generation that failed or ran out of time may still have spent: count it.
    if (asked !== undefined) {
      result.wallMs ??= Date.now() - asked;
      result.cost = await costOf(db, user, new Date(asked - 1000), new Date()).catch(() => result.cost);
    }
  } finally {
    // A paid person's onboarding counts them in for nightly runs: leave none due.
    await db.unsafe(`DELETE FROM suggestion_audience WHERE user_id = $1`, [user]).catch(() => {});
    clearInbox(at.instance, email);
    if (transcript.size) {
      result.transcript = `${out}.transcript.jsonl`;
      writeFileSync(result.transcript, [...transcript.values()].map((line) => JSON.stringify(line)).join('\n') + '\n');
    }
    await db.close();
  }
  return result;
}
