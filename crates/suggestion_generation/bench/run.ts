// One generation for one persona: seed a clean copy, start the generation
// the way the app does, watch it to the end while keeping its sessions'
// transcripts (they are deleted with the sessions), and read back what it
// wrote, how long it took and what it cost.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** FusionAuth on `instance`: its host port and API key, from what `run_local` generated. */
function fusionAuth(instance: string): { url: string; key: string } {
  const generated = join(REPO, 'infra/local/generated', instance);
  const compose = readFileSync(join(generated, 'docker-compose.override.yml'), 'utf8');
  const port = compose.split(/\n {2}fusionauth:\n/)[1]?.split(/\n {2}\S/)[0].match(/- "?(\d+):9011"?/)?.[1];
  const key = readFileSync(join(generated, 'local.generated.env'), 'utf8').match(/^FUSIONAUTH_API_KEY=(.*)$/m)?.[1];
  if (!port || !key) throw new Error(`no FusionAuth port or API key in ${instance}'s generated files`);
  return { url: `http://localhost:${port}`, key };
}

/** Delete `email`'s FusionAuth account, so seeding them signs them up anew. */
async function forgetLogin(instance: string, email: string) {
  const auth = fusionAuth(instance);
  const found = await fetch(`${auth.url}/api/user?email=${encodeURIComponent(email)}`, { headers: { Authorization: auth.key } });
  if (found.status === 404) return;
  if (!found.ok) throw new Error(`FusionAuth lookup of ${email}: ${found.status}`);
  const { user } = (await found.json()) as { user: { id: string } };
  const gone = await fetch(`${auth.url}/api/user/${user.id}?hardDelete=true`, { method: 'DELETE', headers: { Authorization: auth.key } });
  if (!gone.ok) throw new Error(`FusionAuth delete of ${email}: ${gone.status}`);
  // The delete settles after it answers; seeding before then finds the old
  // account, creates none, and leaves the person with no login.
  for (let attempt = 0; ; attempt++) {
    const after = await fetch(`${auth.url}/api/user?email=${encodeURIComponent(email)}`, { headers: { Authorization: auth.key } });
    if (after.status === 404) return;
    if (attempt >= 30) throw new Error(`FusionAuth still has ${email} 30 s after deleting it`);
    await Bun.sleep(1000);
  }
}

/**
 * Seed a variant's scenario afresh, as if each person signed up just now.
 * `apply` alone deletes only rows carrying the scenario's id marker, while a
 * person who signed up through the signup webhook has an id of the
 * database's, so their suggestions from an earlier run would survive. So:
 * `reset` deletes them by email (everything of theirs goes with them), the
 * bench deletes their FusionAuth account, and `apply` signs them up again
 * (FusionAuth keeps the old account's id, and a login with it fails once its
 * user is gone).
 */
export async function seed(instance: string, persona: Persona, variant: Variant, now: number, log: string) {
  const dir = join(CACHE, instance, 'scenarios');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${scenarioName(persona, variant)}.json`);
  writeFileSync(path, `${JSON.stringify(scenario(persona, variant, now), null, 1)}\n`);
  for (const step of ['reset', 'apply']) {
    const result = Bun.spawnSync(['just', 'seed-scenario', '--instance', instance, step, '--file', path], {
      cwd: REPO,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    writeFileSync(log, result.stdout.toString() + result.stderr.toString(), { flag: 'a' });
    if (result.exitCode !== 0) throw new Error(`seed-scenario ${step} ${scenarioName(persona, variant)} exited with ${result.exitCode}; see ${log}`);
    if (step === 'reset') {
      const users = scenario(persona, variant, now).users as Record<string, { email: string }>;
      for (const user of Object.values(users)) await forgetLogin(instance, user.email);
    }
  }
}

/** Rows a clean person has none of; a reset that left any would let one run read another's work. */
const LEFTOVERS = ['suggestion', 'routine_suggestion', 'suggestion_generation', 'suggestion_audience', 'suggestion_change'];

export async function assertClean(db: SQL, user: string) {
  for (const table of LEFTOVERS) {
    const [{ count }] = await db.unsafe(`SELECT count(*)::int AS count FROM ${table} WHERE user_id = $1`, [user]);
    if (count !== 0) throw new Error(`${user} still has ${count} ${table} rows after seeding`);
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
  await seed(at.instance, persona, variant, now, `${out}.seed.log`);
  const db = new SQL(at.postgres);
  try {
    await assertClean(db, userId(ownerEmail(persona, variant)));
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
  try {
    writeInbox(at.instance, email, recentMessages(persona, variant, now));
    const token = await login(at, email);
    const route = trigger === 'onboarding' ? 'generate' : 'regenerate';
    const asked = Date.now();
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
        if (first?.at) result.firstMs = new Date(first.at).getTime() - asked;
      }
      const [state] = await db.unsafe(
        `SELECT status, finished_at, trace_id FROM suggestion_generation WHERE id = $1`,
        [row.id],
      );
      if (state.status !== 'generating') {
        ended = state;
        break;
      }
      if (Date.now() - asked > DEADLINE_MS[trigger]) {
        result.buildFailed = true;
        throw new Error(`generation still running after ${DEADLINE_MS[trigger] / 60_000} minutes`);
      }
      await Bun.sleep(1500);
    }
    result.status = ended.status;
    result.traceId = ended.trace_id;
    result.wallMs = (ended.finished_at ? new Date(ended.finished_at).getTime() : Date.now()) - asked;
    result.sessions = (await db.unsafe(SESSIONS, [row.id])) as SessionRow[];
    result.routines = await routinesOf(db, user);
    result.cards = await cardsOf(db, user);
    // Usage rows land as each model call settles: give the last ones a moment.
    await Bun.sleep(5000);
    result.cost = await costOf(db, user, new Date(asked - 1000), new Date());
  } catch (error) {
    result.error = String(error).slice(0, 500);
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
