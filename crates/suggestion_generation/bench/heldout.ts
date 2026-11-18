// Held-out personas: written by a model on demand, kept outside the
// repository so nobody tuning a prompt reads them, and reported only in
// aggregate. Each run on a set is recorded in its ledger; once a set has
// confirmed a change (a baseline and one candidate) it is spent, and the
// next confirmation needs a fresh set: `heldout make <name>`.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Stack, call, login } from '../../scheduled_action/bench/stack';
import { CATALOG } from './catalog';
import { ANCHOR } from './clock';
import { HELDOUT_DIR, type Persona, personas } from './personas';
import { seed } from './run';

const AUTHOR_MODEL = 'anthropic/claude-opus-5-5';
const AUTHOR = 'author@suggestions-bench.example';
/** Uses of a set per section before its numbers stop being held-out: a baseline and one candidate. */
const USES = 2;

const ledgerPath = (set: string) => join(HELDOUT_DIR, set, 'ledger.jsonl');

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
      const people = readdirSync(join(HELDOUT_DIR, entry.name), { withFileTypes: true }).filter((e) => e.isDirectory()).length;
      return `${entry.name}: ${people} personas; ${counts.join(', ') || 'unused'}`;
    });
}

// ---------- writing a set ----------

let authorToken: Promise<string> | undefined;

async function write<T>(at: Stack, prompt: string, schema: object): Promise<T> {
  authorToken ??= (async () => {
    const author = {
      name: 'author',
      heldout: false,
      dir: '',
      workspace: { scenario: 'sugbench-author', description: 'The account the bench writes held-out personas as.', users: { author: { email: AUTHOR, first_name: 'Bench', last_name: 'Author', roles: ['team_subscriber', 'sub_opus'] } } },
      inbox: { owner: { name: 'Bench Author', email: AUTHOR }, persona: '', timezone: 'UTC', messages: [] },
    } as unknown as Persona;
    seed(at.instance, author, 'full', Date.now(), join(HELDOUT_DIR, 'author.seed.log'));
    return login(at, AUTHOR);
  })();
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await call<{ outcome: { status: string; result?: T; reason?: string } }>(`${at.harness}/cognition/structured-completion`, {
        method: 'POST',
        token: await authorToken,
        body: JSON.stringify({ prompt, model: AUTHOR_MODEL, output_schema: { name: 'authored', schema }, toolset: { type: 'none' } }),
      });
      if (response.outcome.status === 'completed' && response.outcome.result) return response.outcome.result;
      last = response.outcome.reason;
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`writing failed: ${String(last).slice(0, 300)}`);
}

const str = { type: 'string' };
const strs = { type: 'array', items: str };
const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

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

const WORKSPACE = obj({
  projects: { type: 'array', items: obj({ key: str, name: str }) },
  documents: { type: 'array', items: obj({ key: str, owner: str, name: str, project: str, content: str }) },
  tasks: { type: 'array', items: obj({ key: str, owner: str, name: str, status: { type: 'string', enum: ['not_started', 'in_progress', 'completed'] }, assignees: strs, content: str }) },
  channels: { type: 'array', items: obj({ key: str, name: str }) },
  messages: { type: 'array', items: obj({ channel: str, from: str, text: str }) },
  calls: { type: 'array', items: obj({ key: str, channel: str, name: str, ended_minutes_ago: { type: 'integer' }, duration_minutes: { type: 'integer' }, transcript: { type: 'array', items: obj({ speaker: str, text: str }) } }) },
});

const FEED_TRUTH = obj({
  planted: { type: 'array', items: obj({ id: str, what: str, evidence: strs, ideal_suggestion: str }) },
  decoys: { type: 'array', items: obj({ id: str, what: str, why_stale: str }) },
});

const ROUTINES_TRUTH = obj({
  needs: { type: 'array', items: obj({ id: str, what: str, evidence: strs, catalog: strs, drafted: str, surfaces: strs }) },
  decoys: { type: 'array', items: obj({ id: str, what: str, why: str, catalog: strs }) },
});

const anchor = new Date(ANCHOR).toISOString();

/** Write `count` new personas into held-out set `name`. */
export async function makeHeldout(at: Stack, name: string, count: number) {
  if (!name) throw new Error('heldout make <name> [count]');
  const root = join(HELDOUT_DIR, name);
  if (existsSync(root)) throw new Error(`held-out set ${name} exists; pick a new name`);
  mkdirSync(root, { recursive: true });
  const tune = personas('tune').map((persona) => persona.inbox.persona);
  const { people } = await write<{ people: Sketch[] }>(
    at,
    `Invent ${count} people who would use a work app with email, tasks, documents, chat channels, calls, a CRM and calendar. Each runs or works in a small organization; make them differ from each other in industry, role, seniority and how they work, and differ from these existing ones: ${tune.join(' | ')}.
For each: a short slug (lowercase letters), a one-sentence persona, a first and last name, an invented company domain ending in .example, an IANA time zone in the Americas or Europe, the 4 to 6 mail labels they file mail under, 4 colleagues, the recurring streams of mail they get (at least 6, such as weekly reports, invoices, customer requests, tool notifications; say how often each comes), and a situation: what is going on in their work this month.`,
    SKETCH,
  );
  for (const sketch of people.slice(0, count)) {
    const dir = join(root, sketch.slug);
    mkdirSync(dir, { recursive: true });
    const owner = { name: `${sketch.owner_first} ${sketch.owner_last}`, email: `${sketch.owner_first.toLowerCase()}@${sketch.domain}` };
    const who = `${owner.name} <${owner.email}>: ${sketch.persona} Labels: ${sketch.labels.join(', ')}. Colleagues: ${sketch.colleagues.map((c) => `${c.first} ${c.last} (${c.role}, ${c.first.toLowerCase()}@${sketch.domain})`).join('; ')}. Recurring mail: ${sketch.streams.join('; ')}. This month: ${sketch.situation}`;
    // The mailbox, newest first, a quarter at a time.
    const messages: Record<string, unknown>[] = [];
    for (let part = 0; part < 4; part++) {
      const { messages: batch } = await write<{ messages: Record<string, unknown>[] }>(
        at,
        `Write 25 emails from the inbox of ${who}
It is now ${anchor}. Write messages ${part * 25 + 1} to ${part * 25 + 25} of their newest 100, newest first, dated between ${part * 5} and ${part * 5 + 5} days before now (ISO timestamps in UTC). Mix the recurring streams (keep their senders and subjects consistent with earlier messages), real conversations with customers, colleagues and suppliers, a little promotion and one phishing attempt over the whole mailbox. Labels: INBOX on each, UNREAD on a few recent ones, CATEGORY_UPDATES or CATEGORY_PROMOTIONS for automated mail, and their own labels where they would file it. Snippets are the first 300 to 500 characters of the body, concrete (names, amounts, dates, ids). Every name, company and address is invented; addresses end in .example.
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
    const ws = await write<Record<string, Record<string, unknown>[]>>(
      at,
      `Write the work app workspace of ${who}
It is now ${anchor}. Their mail is below. Users are keyed ${keys.join(', ')} (owner is ${owner.name}). Write 3 projects, 8 to 11 documents (markdown, real content: plans, trackers, process notes, meeting notes), 8 to 12 tasks (some completed), 3 or 4 team channels with 25 to 35 messages between them, and 2 calls with transcripts of 8 to 16 turns. Keys are short kebab-case; owners, assignees, speakers and message senders use the user keys; a document's project and a call's channel use those keys.
Plant 6 to 9 opportunities a sharp assistant would raise by connecting the workspace with the mail (a promise not kept, a deadline nobody owns, conflicting work, money left on the table, a stale tracker), each evidenced in at least two places, and 3 decoys: things that look urgent in one place but another place shows are already handled.
<mail>
${digest}
</mail>`,
      WORKSPACE,
    );
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
      `Write the answer key for judging the suggestions feed of ${owner.name}. It is now ${anchor}. List the planted opportunities (ids p1, p2, …: what, evidence as "document:<key>", "task:<key>", "channel:<key>", "call:<key>" or "inbox subject: <subject>", and the ideal suggestion) and the decoys (ids d1, …: what, and why it is stale), exactly as the workspace and mail below show them.
<workspace>${JSON.stringify(workspace)}</workspace>
<mail>${digest}</mail>`,
      FEED_TRUTH,
    );
    writeFileSync(join(dir, 'feed-truth.json'), `${JSON.stringify(feedTruth, null, 1)}\n`);
    const catalog = Object.entries(CATALOG).filter(([, e]) => e.suggest).map(([key, e]) => `${key}: ${e.does} (${e.surfaces.join(', ')})`).join('\n');
    const routinesTruth = await write<{ needs: Record<string, unknown>[]; decoys: Record<string, unknown>[] }>(
      at,
      `Write the answer key for judging automations ("routines") suggested to ${owner.name} a minute after signup, from their mail alone. Needs (ids r1, …, 4 to 6): routines they would still have on a month later because a steady stream of their mail shows the work: what, evidence (subjects), the catalog keys that meet it on their own (empty when only a drafted routine can), what a drafted routine that meets it does (empty when the catalog covers it), and the sidebars (email, calendar, tasks, files, crm, chat, calls, reviews, agents). Make one need "mail sorting" met by inbox or email_tags when they file mail under labels. Decoys (ids x1, …, 3 to 5): routines that look plausible from their mail but that they would switch off, with why, and the catalog keys that are that decoy (empty when none). Include one decoy that would send or act as them.
Catalog:
${catalog}
<mail>${digest}</mail>`,
      ROUTINES_TRUTH,
    );
    routinesTruth.needs = routinesTruth.needs.map((need) => (need.drafted ? need : { ...need, drafted: undefined }));
    writeFileSync(join(dir, 'routines-truth.json'), `${JSON.stringify(routinesTruth, null, 1)}\n`);
    console.log(`wrote held-out persona ${sketch.slug} in ${dir}`);
  }
  console.log(`held-out set ${name} is ready; run it with --set ${name}. Don't open its files while tuning.`);
}
