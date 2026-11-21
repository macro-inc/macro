// Held-out personas: written by a model on demand, kept outside the
// repository so nobody tuning a prompt reads them, and reported only in
// aggregate. Each run on a set is recorded in its ledger; once a set has
// confirmed a change (a baseline and one candidate) it is spent, and the
// next confirmation needs a fresh set: `heldout make <name>`.

import { SQL } from 'bun';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Stack, call, login } from '../../scheduled_action/bench/stack';
import { CATALOG } from './catalog';
import { ANCHOR } from './clock';
import { HELDOUT_DIR, type Persona, folders, personas } from './personas';
import type { MonthSketch } from './month';
import { costOf, seed, userId } from './run';

const AUTHOR_MODEL = 'anthropic/claude-opus-5-5';
const AUTHOR = 'author@suggestions-bench.example';
/** Uses of a set per section before its numbers stop being held-out: a baseline and one candidate. */
const USES = 2;
/** How many people of a set are written at once. */
const WRITERS = 3;

const ledgerPath = (set: string) => join(HELDOUT_DIR, set, 'ledger.jsonl');

/**
 * Hold held-out set `set` to the answer keys its first use scored against:
 * `keys` (`keyDigests`) are the keys a run, rejudge or rescore of it would
 * score against now. Each person's keys are written down (`keys.json` in
 * the set) the first time they are scored, and every later use must score
 * against the same keys, so no key is changed after a build has run on its
 * person. Throws, naming no one, when one changed.
 */
export function fixKeys(set: string, keys: Record<string, string>, dir = HELDOUT_DIR, waitMs = 10_000) {
  const path = join(dir, set, 'keys.json');
  // Bench commands on two instances may fix keys of one set at once: one reads and writes at a time.
  withLock(`${path}.lock`, waitMs, () => fixKeysHeld(set, keys, path));
}

/** A lock older than this was left by a command that died holding it. */
const STALE_LOCK_MS = 60_000;

/** Run `then` holding the lock file `lock`, waiting up to `waitMs` for another holder. */
function withLock(lock: string, waitMs: number, then: () => void) {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age = (() => {
        try {
          return Date.now() - statSync(lock).mtimeMs;
        } catch {
          return 0;
        }
      })();
      if (age > STALE_LOCK_MS) {
        rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() > until) throw new Error(`${lock} is held by another bench command; run this one again when it ends`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    then();
  } finally {
    unlinkSync(lock);
  }
}

function fixKeysHeld(set: string, keys: Record<string, string>, path: string) {
  const fixed = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { keys: Record<string, string> }).keys : {};
  const changed = Object.entries(keys).filter(([name, digest]) => Object.hasOwn(fixed, name) && fixed[name] !== digest).length;
  if (changed) {
    throw new Error(
      `${changed} of ${Object.keys(keys).length} people of held-out set ${set} have answer keys other than the ones they were first scored against (${path}): a held-out set's keys are fixed before any build runs on it. Score against those keys, or make a new set`,
    );
  }
  const added = Object.keys(keys).filter((name) => !Object.hasOwn(fixed, name));
  if (!added.length) return;
  // Written whole or not at all, so a reader never finds half the keys.
  const partial = `${path}.${process.pid}.partial`;
  writeFileSync(partial, `${JSON.stringify({ keys: { ...fixed, ...Object.fromEntries(added.map((name) => [name, keys[name]])) } }, null, 1)}\n`);
  renameSync(partial, path);
}

/** Record a run on `set`, and say so loudly once the set is spent. */
export function spend(set: string, section: string, label: string) {
  const path = ledgerPath(set);
  const used = existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { section: string; label: string })
    : [];
  const before = used.filter((use) => use.section === section);
  if (before.length >= USES) {
    console.warn(
      `held-out set ${set} has been run ${before.length} times for ${section} (${before.map((use) => use.label).join(', ')}): it is spent, and its numbers no longer say how a change does on unseen people. Make a fresh one with \`heldout make\`.`,
    );
  }
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), section, label })}\n`);
}

/** Every held-out set and how often each section has read it. */
export function spent(): string[] {
  if (!existsSync(HELDOUT_DIR)) return [];
  return readdirSync(HELDOUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = ledgerPath(entry.name);
      const uses = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).section as string) : [];
      const counts = Object.entries(Object.groupBy(uses, (use) => use)).map(([section, list]) => `${section} ×${list!.length}${list!.length >= USES ? ' (spent)' : ''}`);
      const people = folders(join(HELDOUT_DIR, entry.name)).length;
      return `${entry.name}: ${people} personas; ${counts.join(', ') || 'unused'}`;
    });
}

// ---------- writing a set ----------

let authorSeeded: Promise<void> | undefined;
let authorToken: Promise<string> | undefined;

/** The author's token, seeding the author once per process. */
export async function author(at: Stack): Promise<string> {
  authorSeeded ??= (async () => {
    const account = {
      name: 'author',
      heldout: false,
      dir: '',
      workspace: { scenario: 'sugbench-author', description: 'The account the bench writes held-out personas as.', users: { author: { email: AUTHOR, first_name: 'Bench', last_name: 'Author', roles: ['team_subscriber', 'sub_opus'] } } },
      inbox: { owner: { name: 'Bench Author', email: AUTHOR }, persona: '', timezone: 'UTC', messages: [] },
    } as unknown as Persona;
    // On a machine that has made no set yet, the folder isn't there.
    mkdirSync(HELDOUT_DIR, { recursive: true });
    await seed(at.instance, account, 'full', Date.now(), join(HELDOUT_DIR, 'author.seed.log'));
  })();
  await authorSeeded;
  // A failed sign-in is not kept: the next call tries again.
  authorToken ??= login(at, AUTHOR).catch((error) => {
    authorToken = undefined;
    throw error;
  });
  return authorToken;
}

export async function write<T>(at: Stack, prompt: string, schema: object, model = AUTHOR_MODEL, thinking?: 'low'): Promise<T> {
  let last: unknown;
  for (let attempt = 0, busy = 0; attempt < 3; attempt++) {
    try {
      const response = await call<{ outcome: { status: string; result?: T; reason?: string } }>(`${at.harness}/cognition/structured-completion`, {
        method: 'POST',
        token: await author(at),
        body: JSON.stringify({ prompt, model, output_schema: { name: 'authored', schema }, toolset: { type: 'none' }, ...(thinking ? { thinking } : {}) }),
      });
      if (response.outcome.status === 'completed' && response.outcome.result) return response.outcome.result;
      last = response.outcome.reason;
    } catch (error) {
      last = error;
      // Local tokens last an hour: sign in again.
      if (/ 401: /.test(String(error))) authorToken = undefined;
      // The harness runs 16 completions at once and refuses the rest: wait for a slot without spending an attempt.
      if (/ 503: .*busy/.test(String(error)) && busy++ < 60) {
        attempt--;
        await Bun.sleep(5_000 + Math.random() * 10_000);
      }
    }
  }
  throw new Error(`writing failed: ${String(last).slice(0, 300)}`);
}

export const str = { type: 'string' };
export const strs = { type: 'array', items: str };
export const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

type Sketch = {
  slug: string;
  persona: string;
  owner_first: string;
  owner_last: string;
  domain: string;
  timezone: string;
  labels: string[];
  colleagues: { first: string; last: string; role: string }[];
  streams: string[];
  situation: string;
};

const SKETCH = obj({
  people: {
    type: 'array',
    items: obj({
      slug: str,
      persona: str,
      owner_first: str,
      owner_last: str,
      domain: str,
      timezone: str,
      labels: strs,
      colleagues: { type: 'array', items: obj({ first: str, last: str, role: str }) },
      streams: strs,
      situation: str,
    }),
  },
});

const MESSAGES = obj({
  messages: {
    type: 'array',
    items: obj({
      from_name: str,
      from_email: str,
      to: strs,
      cc: strs,
      date: str,
      subject: str,
      labels: strs,
      snippet: str,
    }),
  },
});

// The workspace is written in parts: the harness gives a structured
// completion 90 seconds, too few for a whole workspace or 25 emails at once.
const PLAN = obj({
  projects: { type: 'array', items: obj({ key: str, name: str }) },
  channels: { type: 'array', items: obj({ key: str, name: str }) },
  documents: { type: 'array', items: obj({ key: str, owner: str, name: str, project: str, about: str }) },
  tasks: { type: 'array', items: obj({ key: str, owner: str, name: str, status: { type: 'string', enum: ['not_started', 'in_progress', 'completed'] }, assignees: strs }) },
  calls: { type: 'array', items: obj({ key: str, channel: str, name: str, ended_minutes_ago: { type: 'integer' }, duration_minutes: { type: 'integer' }, about: str }) },
  opportunities: strs,
  decoys: strs,
});
const TASKS = obj({ tasks: { type: 'array', items: obj({ key: str, content: str }) } });
const DOCUMENTS = obj({ documents: { type: 'array', items: obj({ key: str, content: str }) } });
const CHAT = obj({ messages: { type: 'array', items: obj({ channel: str, from: str, text: str }) } });
const TRANSCRIPT = obj({ transcript: { type: 'array', items: obj({ speaker: str, text: str }) } });

type Plan = {
  projects: { key: string; name: string }[];
  channels: { key: string; name: string }[];
  documents: { key: string; owner: string; name: string; project: string; about: string }[];
  tasks: { key: string; owner: string; name: string; status: string; assignees: string[] }[];
  calls: { key: string; channel: string; name: string; ended_minutes_ago: number; duration_minutes: number; about: string }[];
  opportunities: string[];
  decoys: string[];
};

const BATCH = 10;

const FEED_TRUTH = obj({
  planted: { type: 'array', items: obj({ id: str, what: str, evidence: strs, ideal_suggestion: str }) },
  decoys: { type: 'array', items: obj({ id: str, what: str, why_stale: str }) },
});

const ROUTINES_TRUTH = obj({
  needs: { type: 'array', items: obj({ id: str, what: str, evidence: strs, catalog: strs, drafted: str, surfaces: strs }) },
  decoys: { type: 'array', items: obj({ id: str, what: str, why: str, catalog: strs }) },
  misfit: strs,
});

export type WrittenRoutinesTruth = { needs: { catalog: string[]; drafted?: string }[]; decoys: { catalog?: string[] }[]; misfit: string[]; fine?: string[] };

/**
 * Give every catalog routine exactly one place, as the bench requires
 * (catalog.ts `keyGaps`): a key the catalog lacks is dropped, a need's key
 * is no decoy or misfit, a decoy's no misfit, and the rest are fine.
 */
export function placeAll(truth: WrittenRoutinesTruth): WrittenRoutinesTruth {
  const known = (keys: string[] = []) => [...new Set(keys.filter((key) => CATALOG[key]))];
  const needs = truth.needs.map((need) => ({ ...need, catalog: known(need.catalog) }));
  const met = new Set(needs.flatMap((need) => need.catalog));
  const decoys = truth.decoys.map((decoy) => ({ ...decoy, catalog: known(decoy.catalog).filter((key) => !met.has(key)) }));
  const lured = new Set(decoys.flatMap((decoy) => decoy.catalog));
  const misfit = known(truth.misfit).filter((key) => !met.has(key) && !lured.has(key));
  const fine = Object.keys(CATALOG).filter((key) => !met.has(key) && !lured.has(key) && !misfit.includes(key));
  return { needs, decoys, misfit, fine };
}

const anchor = new Date(ANCHOR).toISOString();

/**
 * Write `count` new personas into held-out set `name`: with `month`, month
 * personas (month.ts). A set whose writing stopped part way (the model timed
 * out) is finished by running it again: the people are kept in
 * `people.json`, and each is written into a hidden folder that becomes
 * theirs only once all of it is written. Prints what the set cost to write.
 */
export async function makeHeldout(at: Stack, name: string, count: number, month = false) {
  if (!name) throw new Error('heldout make <name> [count] [month]');
  // Loaded here: month.ts builds on this module.
  const { sketchMonth, writeMonthPersona } = await import('./month');
  const root = join(HELDOUT_DIR, name);
  const sketches = join(root, 'people.json');
  const written = (slug: string) => existsSync(join(root, slug));
  const started = new Date();
  let people: (Sketch | MonthSketch)[];
  if (existsSync(sketches)) {
    people = JSON.parse(readFileSync(sketches, 'utf8'));
    if (people.every((sketch) => written(sketch.slug))) throw new Error(`held-out set ${name} exists; pick a new name`);
    const unusable = rosterProblems(people.filter((sketch) => !written(sketch.slug)));
    if (unusable) throw new Error(`${unusable}: held-out set ${name} can't be finished as first planned; make a new one under a new name`);
    console.log(`finishing held-out set ${name}: ${people.length} people, as first written`);
  } else {
    // A folder left before its people were saved has nothing else in it: reuse it.
    if (existsSync(root) && readdirSync(root).some((entry) => entry !== 'people.json.partial')) throw new Error(`held-out set ${name} exists; pick a new name`);
    people = (await (month ? sketchMonth(at, count) : sketch(at, count))).slice(0, count);
    if (people.length < count) throw new Error(`the author sketched ${people.length} of ${count} people; run heldout make again`);
    const unusable = rosterProblems(people);
    if (unusable) throw new Error(`${unusable}; run heldout make again`);
    // A held-out person is someone no earlier set has, by slug, name or mail domain.
    const repeated = repeatsEarlier(people, takenIdentities());
    if (repeated.length) throw new Error(`a sketched person repeats one from an earlier set or this one (by ${repeated.join(', ')}); run heldout make again`);
    const slugs = people.map((person) => person.slug);
    if (slugs.some((slug) => !/^[a-z]+$/.test(slug)) || new Set(slugs).size !== slugs.length) {
      throw new Error('the people came back with unusable or repeated slugs; run heldout make again');
    }
    mkdirSync(root, { recursive: true });
    // Written whole or not at all, so a rerun never reads half a list.
    writeFileSync(`${sketches}.partial`, `${JSON.stringify(people, null, 1)}\n`);
    renameSync(`${sketches}.partial`, sketches);
  }
  const failed: string[] = [];
  // People are written WRITERS at a time: each is its own chain of model
  // calls, so a set of nine takes about as long as a set of three.
  const queue = people.filter((person) => !written(person.slug));
  const writing = queue.length;
  const writer = async () => {
    for (let person = queue.shift(); person; person = queue.shift()) {
      try {
        if ('mail' in person && person.mail === 'month') await writeMonthPersona(at, name, root, person);
        else await writePersona(at, name, root, person as Sketch);
      } catch (error) {
        failed.push(person.slug);
        // A held-out person is never named: their slug, names and domain are cut from the error.
        console.error(`a person of held-out set ${name} could not be written: ${unnamed(person, String(error)).slice(0, 300)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: WRITERS }, writer));
  // What writing cost is reported when it can be read; the set is ready or not all the same.
  await reportCost(at, started, writing - failed.length).catch((error) => console.error(`the writing cost could not be read: ${String(error).slice(0, 200)}`));
  if (failed.length) throw new Error(`held-out set ${name}: ${failed.length} of ${people.length} people not written; run heldout make ${name} again to finish it`);
  console.log(`held-out set ${name} is ready; run it with --set ${name}. Don't open its files while tuning.`);
}

/** `text` with `person`'s slug, names and mail domain cut out, so an error can be printed without naming them. */
export function unnamed(person: Sketch | MonthSketch, text: string): string {
  const names = [person.slug, person.domain, person.owner_first, person.owner_last, ...person.colleagues.flatMap((colleague) => [colleague.first, colleague.last])]
    .filter((word) => word && word.length > 1)
    .sort((a, b) => b.length - a.length);
  return names.reduce((out, word) => out.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '…'), text);
}

/**
 * Why a person's workspace can't be written as sketched, or undefined. Each
 * person is mailed as their first name at the domain and seeded under it,
 * and `owner` is the person themself.
 */
export function rosterProblem(sketch: Pick<Sketch, 'owner_first' | 'colleagues'>): string | undefined {
  const firsts = [sketch.owner_first, ...sketch.colleagues.map((colleague) => colleague.first)].map((first) => first.toLowerCase());
  if (new Set(firsts).size !== firsts.length) return 'two people of one workspace share a first name, and so an address';
  if (sketch.colleagues.some((colleague) => colleague.first.toLowerCase() === 'owner')) return "a colleague named Owner would take the person's own place";
  return undefined;
}

/** How many sketched people's workspaces can't be written, and why, in one line naming none of them; undefined when all can. */
export function rosterProblems(people: Pick<Sketch, 'owner_first' | 'colleagues'>[]): string | undefined {
  const problems = people.flatMap((person) => rosterProblem(person) ?? []);
  return problems.length ? `${problems.length} of ${people.length} sketched people: ${[...new Set(problems)].join('; ')}` : undefined;
}

/** Who a person is, as a new one must not repeat: slug, full name and mail domain, lowercased. */
type Identity = { slug: string; name: string; domain: string };

const identityKeys = (who: Identity) =>
  [`slug:${who.slug}`, `name:${who.name}`, `domain:${who.domain}`].map((key) => key.trim().toLowerCase()).filter((key) => !key.endsWith(':'));

/** Every person of the tune set and of every held-out set, as identity keys, read without showing anyone. */
export function takenIdentities(): Set<string> {
  const sets = existsSync(HELDOUT_DIR) ? readdirSync(HELDOUT_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
  const written = sets.flatMap((set) => {
    const listed = join(HELDOUT_DIR, set.name, 'people.json');
    if (!existsSync(listed)) return [];
    return (JSON.parse(readFileSync(listed, 'utf8')) as Sketch[]).map((s) => ({ slug: s.slug, name: `${s.owner_first} ${s.owner_last}`, domain: s.domain }));
  });
  const tune = personas('tune').map((p) => ({ slug: p.name, name: p.inbox.owner.name, domain: p.inbox.owner.email.split('@')[1] ?? '' }));
  return new Set([...tune, ...written].flatMap(identityKeys));
}

/**
 * What a sketched person shares with an earlier one, or with another of the
 * same set: `slug`, `name` or `domain`, each once; none when nobody repeats.
 * It says which, never whom, so a held-out set stays unread.
 */
export function repeatsEarlier(people: Pick<Sketch, 'slug' | 'owner_first' | 'owner_last' | 'domain'>[], taken: Set<string>): string[] {
  const seen = new Set(taken);
  const repeated = new Set<string>();
  for (const s of people) {
    const keys = identityKeys({ slug: s.slug, name: `${s.owner_first} ${s.owner_last}`, domain: s.domain });
    for (const key of keys) if (seen.has(key)) repeated.add(key.slice(0, key.indexOf(':')));
    for (const key of keys) seen.add(key);
  }
  return [...repeated].sort();
}

/** The slugs, full names and mail domains a new person must not take, for the author's prompt. */
export function takenWords(): string {
  const of = (kind: string) =>
    [...takenIdentities()]
      .filter((key) => key.startsWith(`${kind}:`))
      .map((key) => key.slice(kind.length + 1))
      .sort()
      .join(', ');
  return `Use none of these slugs: ${of('slug')}. None of these full names: ${of('name')}. None of these domains: ${of('domain')}.`;
}

/** What the author spent since `started`, in all and per person written. */
async function reportCost(at: Stack, started: Date, people: number) {
  const db = new SQL(at.postgres);
  try {
    const cost = await costOf(db, userId(AUTHOR), started, new Date());
    const each = people ? `, $${(cost.usd / people).toFixed(2)} for each of ${people} people written` : '';
    const minutes = ((Date.now() - started.getTime()) / 60_000).toFixed(1);
    console.log(`writing cost $${cost.usd.toFixed(2)}${each}, in ${cost.calls} calls (${cost.inputTokens} tokens in, ${cost.outputTokens} out) over ${minutes} minutes`);
  } finally {
    await db.close();
  }
}

/**
 * Every person already written, tune and held-out alike, in a line each: a
 * new set is told to differ from all of them. Without the held-out sets two
 * sets sketched from the same prompt came back as the same people, and a set
 * that repeats a read one is not unseen.
 */
export function takenPeople(): string[] {
  const sets = existsSync(HELDOUT_DIR) ? readdirSync(HELDOUT_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
  const written = sets.flatMap((set) => {
    const listed = join(HELDOUT_DIR, set.name, 'people.json');
    return existsSync(listed) ? (JSON.parse(readFileSync(listed, 'utf8')) as { persona: string }[]).map((person) => person.persona) : [];
  });
  return [...personas('tune').map((persona) => persona.inbox.persona), ...written];
}

async function sketch(at: Stack, count: number): Promise<Sketch[]> {
  const tune = takenPeople();
  const { people } = await write<{ people: Sketch[] }>(
    at,
    `Invent ${count} people who would use a work app with email, tasks, documents, chat channels, calls, a CRM and calendar. Each runs or works in a small organization; make them differ from each other in industry, role, seniority and how they work, and differ from these existing ones: ${tune.join(' | ')}.
For each: a short slug (lowercase letters), a one-sentence persona, a first and last name, an invented company domain ending in .example, an IANA time zone in the Americas or Europe, the 4 to 6 mail labels they file mail under, 4 colleagues, the recurring streams of mail they get (at least 6, such as weekly reports, invoices, customer requests, tool notifications; say how often each comes), and a situation: what is going on in their work this month. ${takenWords()}`,
    SKETCH,
  );
  return people;
}

/** Write one held-out persona's mailbox, workspace and answer keys. */
async function writePersona(at: Stack, name: string, root: string, sketch: Sketch) {
  {
    const dir = join(root, `.${sketch.slug}.partial`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const owner = { name: `${sketch.owner_first} ${sketch.owner_last}`, email: `${sketch.owner_first.toLowerCase()}@${sketch.domain}` };
    const who = `${owner.name} <${owner.email}>: ${sketch.persona} Labels: ${sketch.labels.join(', ')}. Colleagues: ${sketch.colleagues.map((c) => `${c.first} ${c.last} (${c.role}, ${c.first.toLowerCase()}@${sketch.domain})`).join('; ')}. Recurring mail: ${sketch.streams.join('; ')}. This month: ${sketch.situation}`;
    // The mailbox, newest first, ten at a time.
    const messages: Record<string, unknown>[] = [];
    for (let part = 0; part < 100 / BATCH; part++) {
      const { messages: batch } = await write<{ messages: Record<string, unknown>[] }>(
        at,
        `Write ${BATCH} emails from the inbox of ${who}
It is now ${anchor}. Write messages ${part * BATCH + 1} to ${part * BATCH + BATCH} of their newest 100, newest first, dated between ${part * 2} and ${part * 2 + 2} days before now (ISO timestamps in UTC). Mix the recurring streams (keep their senders and subjects consistent with earlier messages), real conversations with customers, colleagues and suppliers, a little promotion${part === 3 ? ', and one phishing attempt' : ''}. Labels: INBOX on each, UNREAD on a few recent ones, CATEGORY_UPDATES or CATEGORY_PROMOTIONS for automated mail, and their own labels where they would file it. Snippets are the first 300 to 500 characters of the body, concrete (names, amounts, dates, ids). Every name, company and address is invented; addresses end in .example.
${messages.length ? `Earlier batches' subjects, so you don't repeat them: ${messages.map((m) => m.subject).join(' | ')}` : ''}`,
        MESSAGES,
      );
      messages.push(...batch);
    }
    const inbox = {
      owner,
      persona: sketch.persona,
      timezone: sketch.timezone,
      messages: messages.map((m) => ({
        from: { name: m.from_name, email: m.from_email },
        to: m.to,
        cc: m.cc,
        date: m.date,
        subject: m.subject,
        labels: m.labels,
        snippet: m.snippet,
      })),
    };
    writeFileSync(join(dir, 'inbox.json'), `${JSON.stringify(inbox, null, 1)}\n`);
    const digest = inbox.messages.map((m, i) => `[${i + 1}] ${m.date} ${m.from.email} | ${m.subject} | ${(m.labels as string[]).join(',')}\n${m.snippet}`).join('\n');
    const keys = ['owner', ...sketch.colleagues.map((c) => c.first.toLowerCase())];
    const plan = await write<Plan>(
      at,
      `Plan the work app workspace of ${who}
It is now ${anchor}. Their mail is below. Users are keyed ${keys.join(', ')} (owner is ${owner.name}). Plan 3 projects, 3 or 4 team channels, 8 to 11 documents (plans, trackers, process notes, meeting notes: for each, what it says in two or three sentences), 8 to 12 tasks (some completed), and 2 calls (for each, who said what in two or three sentences). Keys are short kebab-case; owners and assignees use the user keys; a document's project and a call's channel use those keys.
Plant 6 to 9 opportunities a sharp assistant would raise by connecting the workspace with the mail (a promise not kept, a deadline nobody owns, conflicting work, money left on the table, a stale tracker), each evidenced in at least two places, and 3 decoys: things that look urgent in one place but another place shows are already handled. List each under opportunities or decoys with where its evidence is (document, task, channel or call keys, mail subjects).
<mail>
${digest}
</mail>`,
      PLAN,
    );
    const brief = `The workspace plan of ${who}
It is now ${anchor}. Users are keyed ${keys.join(', ')}.
<plan>${JSON.stringify(plan)}</plan>`;
    const contents = new Map<string, string>();
    for (let i = 0; i < plan.documents.length; i += 3) {
      const part = plan.documents.slice(i, i + 3);
      const { documents } = await write<{ documents: { key: string; content: string }[] }>(
        at,
        `${brief}
Write the markdown content of documents ${part.map((d) => d.key).join(', ')}: real content, 150 to 400 words each, as the plan says, carrying every detail the plan's opportunities and decoys put in them.`,
        DOCUMENTS,
      );
      for (const d of documents) contents.set(d.key, d.content);
    }
    const { tasks } = await write<{ tasks: { key: string; content: string }[] }>(
      at,
      `${brief}
Write the content of every task (${plan.tasks.map((t) => t.key).join(', ')}): one to three sentences each, with every detail the plan's opportunities and decoys put in it.`,
      TASKS,
    );
    for (const t of tasks) contents.set(`task:${t.key}`, t.content);
    // A document or task the writer dropped would lose the evidence the plan put in it.
    const unwritten = [...plan.documents.map((d) => d.key), ...plan.tasks.map((t) => `task:${t.key}`)].filter((key) => !contents.has(key));
    if (unwritten.length) throw new Error(`${sketch.slug}: ${unwritten.join(', ')} came back unwritten`);
    const { messages: chat } = await write<{ messages: Record<string, unknown>[] }>(
      at,
      `${brief}
Write 25 to 35 messages across the channels, oldest first, from the user keys, carrying every detail the plan's opportunities and decoys put in channels.`,
      CHAT,
    );
    const transcripts = new Map<string, unknown[]>();
    for (const c of plan.calls) {
      const { transcript } = await write<{ transcript: unknown[] }>(
        at,
        `${brief}
Write the transcript of call ${c.key} ("${c.name}"): 8 to 16 turns, speakers are user keys, as the plan says, with every commitment or detail the plan's opportunities and decoys put in it.`,
        TRANSCRIPT,
      );
      transcripts.set(c.key, transcript);
    }
    const ws = {
      projects: plan.projects,
      documents: plan.documents.map((d) => ({ ...d, content: contents.get(d.key)! })),
      tasks: plan.tasks.map((t) => ({ ...t, content: contents.get(`task:${t.key}`)! })),
      channels: plan.channels,
      messages: chat,
      calls: plan.calls.map((c) => ({ ...c, transcript: transcripts.get(c.key) ?? [] })),
    };
    const users = Object.fromEntries([
      ['owner', { email: owner.email, first_name: sketch.owner_first, last_name: sketch.owner_last, roles: ['team_subscriber', 'sub_opus'] }],
      ...sketch.colleagues.map((c) => [c.first.toLowerCase(), { email: `${c.first.toLowerCase()}@${sketch.domain}`, first_name: c.first, last_name: c.last }]),
    ]);
    const byKey = <T extends { key: string }>(items: T[], map: (item: T) => unknown) => Object.fromEntries(items.map((item) => [item.key, map(item)]));
    const team = sketch.slug;
    const workspace = {
      scenario: `sugbench-h-${sketch.slug}`,
      description: `${sketch.persona} (held-out set ${name})`,
      users,
      teams: { [team]: { name: sketch.domain.replace(/\.example$/, ''), owner: 'owner', members: Object.fromEntries(sketch.colleagues.map((c) => [c.first.toLowerCase(), 'member'])) } },
      projects: byKey(ws.projects as { key: string; name: string }[], (p) => ({ owner: 'owner', name: p.name, share: [{ with: `team:${team}`, level: 'edit' }] })),
      documents: byKey(ws.documents as { key: string; owner: string; name: string; project: string; content: string }[], (d) => ({ owner: d.owner, name: d.name, project: d.project, share: [{ with: `team:${team}`, level: 'edit' }], content: d.content })),
      tasks: byKey(ws.tasks as { key: string; owner: string; name: string; status: string; assignees: string[]; content: string }[], (t) => ({ owner: t.owner, name: t.name, status: t.status, assignees: t.assignees, share_with_team: true, content: t.content })),
      channels: byKey(ws.channels as { key: string; name: string }[], (c) => ({ type: 'team', name: c.name, team })),
      messages: ws.messages,
      calls: byKey(ws.calls as { key: string; channel: string; name: string; ended_minutes_ago: number; duration_minutes: number; transcript: unknown[] }[], (c) => ({ channel: c.channel, created_by: 'owner', participants: keys, duration_minutes: c.duration_minutes, ended_minutes_ago: c.ended_minutes_ago, name: c.name, transcript: c.transcript })),
    };
    writeFileSync(join(dir, 'workspace.json'), `${JSON.stringify(workspace, null, 1)}\n`);
    const feedTruth = await write(
      at,
      `Write the answer key for judging the suggestions feed of ${owner.name}. It is now ${anchor}. List the planted opportunities (ids p1, p2, …: what, evidence as "document:<key>", "task:<key>", "channel:<key>", "call:<key>" or "inbox subject: <subject>", and the ideal suggestion) and the decoys (ids d1, …: what, and why it is stale), exactly as the workspace and mail below show them. The planted opportunities are these and no others, one entry each:
${plan.opportunities.map((o) => `- ${o}`).join('\n')}
The decoys are these and no others, one entry each:
${plan.decoys.map((o) => `- ${o}`).join('\n')}
<workspace>${JSON.stringify(workspace)}</workspace>
<mail>${digest}</mail>`,
      FEED_TRUTH,
    );
    writeFileSync(join(dir, 'feed-truth.json'), `${JSON.stringify(feedTruth, null, 1)}\n`);
    const catalog = Object.entries(CATALOG).map(([key, e]) => `${key}: ${e.does} (${e.surfaces.join(', ')})`).join('\n');
    const routinesTruth = await write<WrittenRoutinesTruth>(
      at,
      `Write the answer key for judging automations ("routines") suggested to ${owner.name} a minute after signup, from their mail alone. Needs (ids r1, …, 4 to 6): routines they would still have on a month later because a steady stream of their mail shows the work: what, evidence (subjects), the catalog keys that meet it on their own (empty when only a drafted routine can), what a drafted routine that meets it does (empty when the catalog covers it), and the sidebars (email, calendar, tasks, files, crm, chat, calls, reviews, agents). Make one need "mail sorting" met by inbox or email_tags when they file mail under labels. Decoys (ids x1, …, 3 to 5): routines that look plausible from their mail but that they would switch off, with why, and the catalog keys that are that decoy (empty when none). Include one decoy that would send or act as them. Misfit: every other catalog key that would do nothing for how this person works (a deal pipeline for someone with no deals, call recaps for someone whose work never happens on calls); a part of the app they haven't used yet is not a misfit for that reason alone. Every catalog key you leave out of needs, decoys and misfit counts as fine for them.
Catalog:
${catalog}
<mail>${digest}</mail>`,
      ROUTINES_TRUTH,
    );
    const placed = placeAll(routinesTruth);
    placed.needs = placed.needs.map((need) => (need.drafted ? need : { ...need, drafted: undefined }));
    writeFileSync(join(dir, 'routines-truth.json'), `${JSON.stringify(placed, null, 1)}\n`);
    renameSync(dir, join(root, sketch.slug));
    console.log('wrote a held-out persona');
  }
}
