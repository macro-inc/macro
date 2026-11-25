// One generation for one persona: seed a clean copy, start the generation
// the way the app does, watch it to the end while keeping its sessions'
// transcripts (they are deleted with the sessions), and read back what it
// wrote, how long it took and what it cost.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { SQL } from 'bun';

import { type Stack, call, login } from '../../scheduled_action/bench/stack';
import { type Persona, type Variant, ownerEmail, recentMessages, scenario, scenarioName, sentMessages, windowMessages } from './personas';
import { clearInbox, writeInbox } from './stub';
import type { WorkList } from './finding';

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
  /** From the request to the first suggestion it wrote, to the last, and to the generation's end. */
  firstMs?: number;
  lastMs?: number;
  wallMs?: number;
  /** The work streams a finding step listed, as its drafting session read them; none where no session read a list. */
  workList?: WorkList;
  /** Why a brief's work list couldn't be read: the bench's fault, so the list goes unjudged rather than scored empty. */
  listError?: string;
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
   AND c.conrelid::regclass::text ~ '^(routine_)?suggestion'
 -- A suggestion before the topic it names.
 ORDER BY name`;

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

/** What a drafting session's brief says before the work streams it was given. */
const WORK_LIST_MARK = 'The streams of work a step found';
/** The mark where the brief puts it: at the start of a line. */
const LINE_MARK = new RegExp(`(^|\\n)${WORK_LIST_MARK}`, 'g');

function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) yield* strings(item);
}

type TranscriptRow = { session?: string; direction?: string; created_at?: string; content?: { method?: unknown; params?: unknown } };

/** Whether `row` is a prompt the harness sent a runtime. */
const isPrompt = (row: TranscriptRow) => row?.direction === 'to_runtime' && row.content?.method === 'session/prompt';


/** Whether `value` has the shape of a work list (`finding.ts` `WORK_LIST`). */
function isWorkList(value: unknown): value is WorkList {
  const list = value as WorkList | null;
  if (!list || typeof list !== 'object' || typeof list.person !== 'string' || !Array.isArray(list.streams)) return false;
  return list.streams.every(
    (stream) =>
      stream &&
      typeof stream === 'object' &&
      (['name', 'cadence', 'what', 'action', 'handled_by', 'keeps'] as const).every((field) => typeof stream[field] === 'string') &&
      Number.isInteger(stream.count) &&
      Array.isArray(stream.senders) &&
      stream.senders.every((sender) => sender && typeof sender === 'object' && typeof sender.name === 'string' && typeof sender.email === 'string') &&
      isTexts(stream.labels) &&
      isTexts(stream.examples),
  );
}

const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Where `text`'s `<untrusted>` blocks start and end. */
const untrustedSpans = (text: string) => [...text.matchAll(/<untrusted>\n[\s\S]*?\n<\/untrusted>/g)].map((m) => [m.index, m.index + m[0].length] as const);

/**
 * `text` with markdown's backslash escapes undone. The prompt the harness
 * sends a runtime escapes punctuation (`handled\_by`); JSON escapes only
 * `"`, `\` and `/` before punctuation, so every other backslash before
 * punctuation is markdown's.
 */
export function unescapeMarkdown(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const next = text[i + 1];
    if (text[i] === '\\' && next !== undefined && /^[!-\/:-@\[-`{-~]$/.test(next)) {
      out += '"\\/'.includes(next) ? text[i] + next : next;
      i++;
    } else {
      out += text[i];
    }
  }
  return out;
}

/**
 * `text` with the links a Markdown round trip makes of a bare address,
 * domain or URL undone: `[x](mailto:x)` and `[x](x)` read as `x`, and so
 * does a link element (`<m-link>{"url":…,"text":"x"}</m-link>`) whose
 * target is `x` spelled as a link (`x`, `https://x`, `mailto:x`). A link
 * whose text isn't its target was written as one and stays, an element as
 * the Markdown link it was written as. A quote the round trip unescaped
 * leaves the list no longer JSON, which reads as the list's error.
 */
export function unlinkMarkdown(text: string): string {
  return text
    .replace(/<m-link>(\{[^<>]*?\})<\/m-link>/g, (element, body: string) => {
      try {
        const link = JSON.parse(body) as { url?: unknown; text?: unknown };
        if (typeof link.text !== 'string' || typeof link.url !== 'string') return element;
        // A text with a scheme of its own is a URL, linked as written; any other is an address or a
        // host (`mill.example:8443/po` has a port, not a scheme), given a slash only where it is bare:
        // no path, query or fragment.
        const t = link.text;
        const hosts = /[/?#]/.test(t) ? [t] : [t, `${t}/`];
        const spelled = /^([a-z][a-z0-9+.-]*:\/\/|(mailto|tel):)/i.test(t) ? [t] : [t, ...hosts.flatMap((host) => [`https://${host}`, `http://${host}`]), `mailto:${t}`];
        return spelled.includes(link.url) ? t : `[${t}](${link.url})`;
      } catch {
        return element;
      }
    })
    .replace(/\[([^[\]\n]+)\]\((?:mailto:)?([^)\s]+)\)/g, (link, label: string, target: string) => (label === target ? label : link));
}

/**
 * The work list one brief carried, if it carried one. The brief starts a
 * line with `WORK_LIST_MARK`, outside any `<untrusted>` block, and the list's
 * block follows that line. The mark inside a block is mail (a subject, say),
 * and inside a line it is quoted (a dismissed routine's name): neither is the
 * list. The block holds the list in a fenced `json` block, which the
 * harness's Markdown round trip leaves as written, or (in briefs before the
 * fence) bare, with the round trip's escapes to undo.
 */
function listIn(row: TranscriptRow): WorkList | undefined {
  for (const text of strings(row.content?.params)) {
    const spans = untrustedSpans(text);
    const at = [...text.matchAll(LINE_MARK)].map((m) => m.index + m[1].length).find((start) => !spans.some(([from, to]) => start > from && start < to));
    if (at === undefined) continue;
    const block = /^[^\n]*\n<untrusted>\n(?:\n```json\n([\s\S]*?)\n```\n\n|([\s\S]*?)\n)<\/untrusted>/.exec(text.slice(at));
    if (!block) throw new Error(`a brief says it carries a work list but has no <untrusted> block after it`);
    let list: unknown;
    try {
      list = JSON.parse(block[1] ?? unlinkMarkdown(unescapeMarkdown(block[2])));
    } catch (error) {
      throw new Error(`a brief's work list isn't JSON: ${String(error).slice(0, 200)}`);
    }
    if (!isWorkList(list)) throw new Error("a brief's work list hasn't the list's shape (finding.ts WORK_LIST)");
    return list;
  }
  return undefined;
}

/** `workListOf`, with why it couldn't read a list in place of throwing. */
export function readWorkList(rows: Iterable<unknown>): { list?: WorkList; error?: string } {
  try {
    return { list: workListOf(rows) };
  } catch (error) {
    return { error: String(error instanceof Error ? error.message : error).slice(0, 300) };
  }
}

/**
 * Read `generation`'s work list again from its sessions' transcript, where
 * it was saved or beside the run file at `runPath` (a run directory moved
 * with its transcripts). A re-read can only correct the run's reading with
 * what it finds, never take it away:
 * - a list found is the list; a transcript or brief that can't be read is
 *   the list's error;
 * - finding no list, the run's reading stands: its list, its error, or none
 *   read (the transcript may hold only some sessions, or briefs the bench
 *   can't tell from others);
 * - a transcript that is gone, or holds no prompt to a runtime (empty, say),
 *   can't say what was read: the run's reading stands, and with neither a
 *   list nor an error, whether its sessions read one is unknown, an error.
 * Says why when the run's reading stands.
 */
export function rereadList(generation: Generation, runPath: string): string | undefined {
  const saved = generation.transcript;
  if (!saved) return undefined;
  const transcript = [saved, join(dirname(runPath), basename(saved))].find((file) => existsSync(file));
  const unknown = (why: string) => {
    if (!generation.workList && !generation.listError) generation.listError = `${why}, and the run read no list, so whether its sessions read one is unknown`;
    return `${why}, so its work list is judged as the run first read it`;
  };
  if (!transcript) return unknown(`${saved} is gone`);
  let rows: unknown[];
  try {
    rows = readFileSync(transcript, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown);
  } catch (error) {
    generation.workList = undefined;
    generation.listError = `reading ${transcript}: ${String(error).slice(0, 200)}`;
    return undefined;
  }
  if (!rows.some((row) => isPrompt(row as TranscriptRow))) return unknown(`${transcript} holds no prompt to a runtime`);
  const { list, error } = readWorkList(rows);
  if (!list && !error) return `${transcript} holds no brief with a list, so the run's reading of it stands`;
  generation.workList = list;
  generation.listError = error;
  return undefined;
}

/**
 * The work list a generation's drafting sessions were briefed with, from
 * their transcript rows. Each session reads its share of the streams in the
 * earliest prompt the harness sent its runtime; the shares put together, in
 * the order the sessions started, are the list (a retried session reads the
 * same share again, which counts once). A brief that says it carries a list
 * the bench can't read throws: the drafting brief (the finding PR's
 * `prompt.rs`) and `WORK_LIST_MARK` have drifted apart.
 */
export function workListOf(rows: Iterable<unknown>): WorkList | undefined {
  const prompts = [...rows]
    .map((row) => row as TranscriptRow)
    .filter(isPrompt)
    // `capture` writes `created_at` at a fixed width in UTC, so its text sorts as its time does.
    .sort((a, b) => ((a.created_at ?? '') < (b.created_at ?? '') ? -1 : (a.created_at ?? '') > (b.created_at ?? '') ? 1 : 0));
  const shares = new Map<string | undefined, WorkList>();
  for (const row of prompts) {
    if (shares.has(row.session)) continue;
    const list = listIn(row);
    if (list) shares.set(row.session, list);
  }
  const lists = [...shares.values()];
  if (!lists.length) return undefined;
  const seen = new Set<string>();
  const streams = lists
    .flatMap((list) => list.streams)
    .filter((stream) => {
      const key = JSON.stringify(stream);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { person: lists[0].person, streams };
}

async function capture(db: SQL, generation: string, seen: Map<string, unknown>) {
  const rows = await db.unsafe(
    `SELECT l.id::text, l.agent_session_id::text AS session, l.direction, l.content,
            to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
       FROM agent_session_log l
       JOIN suggestion_generation_session s ON s.session_id = l.agent_session_id
      WHERE s.generation_id = $1
      ORDER BY l.created_at, l.id`,
    [generation],
  );
  for (const row of rows) seen.set(row.id, row);
}

export async function costOf(db: SQL, user: string, from: Date, to: Date): Promise<Cost> {
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
    writeInbox(at.instance, email, recentMessages(persona, variant, now), windowMessages(persona, variant, now), sentMessages(persona, variant, now));
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
    const [last] = await db.unsafe(
      `SELECT greatest((SELECT max(created_at) FROM suggestion WHERE user_id = $1),
                       (SELECT max(created_at) FROM routine_suggestion WHERE user_id = $1)) AS at`,
      [user],
    );
    if (last?.at) result.lastMs = new Date(last.at).getTime() - start;
    await capture(db, row.id, transcript);
    ({ list: result.workList, error: result.listError } = readWorkList(transcript.values()));
    // Usage rows land as each model call settles: give the last ones a moment.
    await Bun.sleep(5000);
    result.cost = await costOf(db, user, new Date(start - 1000), new Date());
  } catch (error) {
    result.error = String(error).slice(0, 500);
    // A generation that ran out of time may have briefed its drafting sessions: its list is scored all the same, from the transcript as it stands now.
    if (result.generationId) await capture(db, result.generationId, transcript).catch(() => {});
    if (transcript.size && !result.workList) ({ list: result.workList, error: result.listError } = readWorkList(transcript.values()));
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
