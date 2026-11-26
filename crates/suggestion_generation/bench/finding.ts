// The finding step, measured on its own: one model call reads a month
// persona's mail as the month read serves it and lists the work streams in
// it; a judge then matches each listed stream to the persona's streams key.
// A list is scored by the key's work streams it names (found) and the
// entries that name none of them (unreal: a noise stream, a one-off thread,
// or nothing in the mail).

import { SQL } from 'bun';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Stack } from '../../scheduled_action/bench/stack';
import { type MailStream, type Persona, SENT_TEXTS, WINDOW_DAYS, asWritten, sentMessages, truthAt, windowMessages } from './personas';
import { author, obj, str, strs, write } from './heldout';
import { CACHE, type Cost, costOf, userId } from './run';
import { MIN_HELDOUT_PEOPLE, quantile } from './score';

const JUDGE_MODEL = 'anthropic/claude-opus-5-5';
const AUTHOR = 'author@suggestions-bench.example';
/** The finding call's instructions. */
export const FIND_PROMPT = join(import.meta.dir, 'find.md');

const int = { type: 'integer' };

/** What a person does with a stream, as the finding call answers it (`work.rs` `Does`); any other word reads as unknown. */
const DOES_WORDS = ['answers', 'forwards', 'files', 'leaves', 'sends', 'unknown'];

/** What the finding step answers. */
export type FoundStream = {
  name: string;
  senders: { name: string; email: string }[];
  count: number;
  cadence: string;
  what: string;
  action: string;
  /** What the person does with it (`work.rs` `Does`); lists found before sent mail was read have none. */
  does?: string;
  to?: string[];
  sent?: number;
  handled_by: string;
  labels: string[];
  keeps: string;
  examples: string[];
};
export type WorkList = { person: string; streams: FoundStream[] };

export const WORK_LIST = obj({
  person: str,
  streams: {
    type: 'array',
    items: obj({
      name: str,
      senders: { type: 'array', items: obj({ name: str, email: str }) },
      count: int,
      cadence: str,
      what: str,
      action: str,
      does: { type: 'string', enum: DOES_WORDS },
      to: strs,
      sent: int,
      handled_by: str,
      labels: strs,
      keeps: str,
      examples: strs,
    }),
  },
});

/** Most streams a list keeps (`work.rs` `MAX_STREAMS`). */
const MAX_STREAMS = 20;

/**
 * `list` as a drafting session reads it (`work.rs` `WorkList::from_answer`):
 * streams without a name dropped, the first `MAX_STREAMS` kept, every text
 * cut as the service cuts it. Throws where the service refuses the answer: a
 * count that isn't a whole number from 0 to 2^32 - 1.
 */
export function boundedList(list: WorkList): WorkList {
  for (const stream of list.streams) {
    if (!Number.isInteger(stream.count) || stream.count < 0 || stream.count > 0xffff_ffff) throw new Error(`a stream's count ${stream.count} is not a u32`);
  }
  const items = (texts: string[]) => texts.slice(0, 5).map((text) => cut(text, 200));
  return {
    person: cut(list.person, 400),
    streams: list.streams
      .filter((stream) => trimAsRust(stream.name))
      .slice(0, MAX_STREAMS)
      .map((stream) => ({
        name: cut(stream.name, 80),
        senders: stream.senders.slice(0, 5).map((sender) => ({ name: cut(sender.name, 120), email: cut(sender.email, 120) })),
        count: stream.count,
        cadence: cut(stream.cadence, 120),
        what: cut(stream.what, 400),
        action: cut(stream.action, 400),
        ...(stream.does === undefined
          ? {}
          : { does: DOES_WORDS.includes(stream.does) ? stream.does : 'unknown', to: (stream.to ?? []).slice(0, 5).map((to) => cut(to, 120)), sent: stream.sent ?? 0 }),
        handled_by: cut(stream.handled_by, 120),
        labels: items(stream.labels),
        keeps: cut(stream.keeps, 400),
        examples: items(stream.examples),
      })),
  };
}

/** `text` without the whitespace Rust's `str::trim` takes off its ends (Unicode's White_Space, which JavaScript's `trim` differs from at U+0085 and U+FEFF). */
export const trimAsRust = (text: string) => text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');

/** Labels every message in an inbox carries, which the finding call leaves out. */
const HIDDEN_LABELS = new Set(['INBOX', 'UNREAD']);

/** `text` as the finding call reads it (`suggestions/prompt.rs` `truncate`): on one line, cut to `max` characters, angle brackets swapped for look-alikes. */
function cut(text: string, max: number): string {
  return [...text.replace(/</g, '\u2039').replace(/>/g, '\u203A').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')]
    .slice(0, max)
    .join('');
}

/**
 * The month's mail as the finding call reads it (`suggestions/work.rs`
 * `line`): one line per message, newest first, the text of the newest under
 * its line. With `sent`, what the person sent, each line naming whom it went
 * to.
 */
export function mailText(persona: Persona, now: number, sent = false): string {
  const messages = sent ? sentMessages(persona, 'full', now).messages : windowMessages(persona, 'full', now).messages;
  const lines = messages.map((message) => {
    const labels = message.labels.filter((label) => !HIDDEN_LABELS.has(label)).slice(0, 5).map((label) => cut(label, 120));
    const from = sent
      ? `to ${message.to.slice(0, 3).map((to) => cut(to, 120)).join(', ')}`
      : cut(trimAsRust(message.from.name) ? `${message.from.name} <${message.from.email}>` : message.from.email, 120);
    const head = `${message.received_at.slice(0, 16).replace('T', ' ')} · ${from} · ${cut(message.subject, 200)}${labels.length ? ` · ${labels.join(', ')}` : ''}`;
    const text = message.snippet ? trimAsRust(message.snippet) : undefined;
    return text ? `${head}\n    ${cut(text, 500)}` : head;
  });
  return lines.join('\n');
}

export function findPrompt(instructions: string, persona: Persona, now: number): string {
  return `${instructions}
It is now ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC. The mail that reached them in the last ${WINDOW_DAYS} days, newest first: a line per message (when, from, subject and labels), and the text of the newest 100 under its line.

<untrusted>
${mailText(persona, now)}
</untrusted>

What they sent in those days, newest first: a line per message (when, to whom, subject), and the text of the newest ${SENT_TEXTS} under its line.

<untrusted>
${mailText(persona, now, true) || '(nothing)'}
</untrusted>`;
}

export type EntryMark = { n: number; stream: string; also: string[]; why: string };

const MARKS = obj({ entries: { type: 'array', items: obj({ n: int, stream: str, also: strs, why: str }) } });

const keyText = (streams: MailStream[]) =>
  streams
    .map((s) => `${s.id} (${s.kind}) ${s.name}: from ${s.senders.map((x) => x.email).join(', ')}; ${s.count} messages, ${s.cadence}. ${s.what} They: ${s.action}. Examples: ${s.examples.join(' | ')}`)
    .join('\n');

const listText = (list: WorkList) =>
  list.streams
    .map((s, i) => `${i + 1}. ${s.name}: from ${s.senders.map((x) => x.email).join(', ')}; ${s.count} messages, ${s.cadence}. ${s.what} They: ${s.action}. Examples: ${s.examples.join(' | ')}`)
    .join('\n');

/** Why `marks` can't score `list` against `key`: an entry unmarked, off the list or marked twice, or a stream the key doesn't have; undefined when they can. */
export function marksProblem(list: WorkList, key: MailStream[], marks: EntryMark[]): string | undefined {
  const ids = new Set(key.map((stream) => stream.id));
  const marked = new Set<number>();
  for (const mark of marks) {
    if (!Number.isInteger(mark.n) || mark.n < 1 || mark.n > list.streams.length) return `entry ${mark.n} is not on the list`;
    if (marked.has(mark.n)) return `entry ${mark.n} is marked twice`;
    marked.add(mark.n);
    if (mark.stream && !ids.has(mark.stream)) return `entry ${mark.n} names ${mark.stream}, which the key doesn't have`;
    const unknown = mark.also.find((id) => !ids.has(id));
    if (unknown !== undefined) return `entry ${mark.n} also names ${unknown}, which the key doesn't have`;
  }
  if (marked.size < list.streams.length) return `${list.streams.length - marked.size} of ${list.streams.length} entries are unmarked`;
  return undefined;
}

/** Match each listed stream to the key; a judge whose marks don't fit the list is asked again, twice at most. */
export async function judgeList(at: Stack, persona: Persona, list: WorkList, now: number): Promise<EntryMark[]> {
  if (!list.streams.length) return [];
  const key = truthAt(persona.streamsTruth!, now).streams;
  const prompt = `You check a list of work streams that a step found in one person's mail against the answer key: every stream of that mail, as it was written. Each key stream has an id and a kind: "work" is mail they act on, "noise" mail they read or ignore, "thread" a one-off conversation about one matter.

For each listed entry give its number n, and stream: the id of the key stream it describes (the same senders and the same kind of message), or "" when it describes none. An entry that covers part of a key stream describes that stream; one that merges several describes the one it mostly covers, and gives the other work streams it covers in full as also (else []). Say why in a few words. Mark strictly and the same way each time.

<key>
${keyText(key)}
</key>

<list>
${asWritten(persona, listText(list))}
</list>`;
  let problem = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const { entries } = await write<{ entries: EntryMark[] }>(at, prompt, MARKS, JUDGE_MODEL);
    const wrong = marksProblem(list, key, entries);
    if (!wrong) return entries;
    problem = wrong;
  }
  throw new Error(`the list judge's marks don't fit the list: ${problem}`);
}

/** A list matched to the key; `unread` where the drafting session read no list, scored as an empty one. */
export type ListScore = { work: number; found: number; unreal: number; duplicates: number; listed: number; missed: string[]; unread?: boolean };

/** No list: what a generation whose drafting sessions read none is scored as. */
export const NO_LIST: WorkList = { person: '', streams: [] };

/** How the work list a generation's drafting sessions read scores against `marks`; one that read none (`workList` undefined) scores as an empty list that found nothing. */
export function scoreWorkList(persona: Persona, workList: WorkList | undefined, marks: EntryMark[]): ListScore {
  return { ...scoreList(persona, workList ?? NO_LIST, marks), ...(workList ? {} : { unread: true }) };
}

export function scoreList(persona: Persona, list: WorkList, marks: EntryMark[]): ListScore {
  const streams = persona.streamsTruth!.streams;
  const work = new Set(streams.filter((s) => s.kind === 'work').map((s) => s.id));
  const found = new Set<string>();
  let unreal = 0;
  let duplicates = 0;
  list.streams.forEach((_, i) => {
    const mark = marks.find((m) => m.n === i + 1);
    // An entry names the work streams it mostly covers and covers in full; one that names none is unreal.
    const named = mark ? [mark.stream, ...mark.also].filter((id) => work.has(id)) : [];
    if (!named.length) {
      unreal++;
      return;
    }
    if (work.has(mark!.stream) && found.has(mark!.stream)) duplicates++;
    for (const id of named) found.add(id);
  });
  return { work: work.size, found: found.size, unreal, duplicates, listed: list.streams.length, missed: [...work].filter((id) => !found.has(id)) };
}

type FindAttempt = { persona: string; rep: number; list?: WorkList; ms?: number; marks?: EntryMark[]; score?: ListScore; error?: string };

/** Run the finding step `reps` times on each persona, then judge every list; the step's cost is the author's usage while it ran. */
export async function runFinding(at: Stack, people: Persona[], opts: { model: string; thinking?: 'low'; reps: number; label: string; set: string; prompt?: string; concurrency: number }) {
  const instructions = readFileSync(opts.prompt ?? FIND_PROMPT, 'utf8');
  // Signed in before any clock starts, so no list's time holds the author's setup.
  await author(at);
  const now = Date.now();
  const jobs = people.flatMap((persona) => Array.from({ length: opts.reps }, (_, rep) => ({ persona, rep: rep + 1 })));
  const attempts: FindAttempt[] = [];
  const started = new Date();
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: opts.concurrency }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const attempt: FindAttempt = { persona: job.persona.name, rep: job.rep };
        const t0 = Date.now();
        try {
          const answer = await write<WorkList>(at, findPrompt(instructions, job.persona, now), WORK_LIST, opts.model, opts.thinking);
          attempt.ms = Date.now() - t0;
          attempt.list = boundedList(answer);
        } catch (error) {
          attempt.error = String(error).slice(0, 300);
        }
        attempts.push(attempt);
        // A held-out person's results stay unread (README, Held-out personas): not even their name or how their call went.
        if (job.persona.heldout) console.log(`held-out list #${job.rep}: ${attempt.list ? 'answered' : 'failed'}`);
        else console.log(`${job.persona.name} #${job.rep}: ${attempt.list ? `${attempt.list.streams.length} streams in ${((attempt.ms ?? 0) / 1000).toFixed(0)} s` : attempt.error}`);
      }
    }),
  );
  const db = new SQL(at.postgres);
  // The lists are judged and saved whether or not their cost can be read.
  let cost: Cost | undefined;
  try {
    cost = await costOf(db, userId(AUTHOR), started, new Date());
  } catch (error) {
    console.error(`the finding step's cost could not be read: ${String(error).slice(0, 200)}`);
  } finally {
    await db.close();
  }
  const byName = new Map(people.map((p) => [p.name, p]));
  await Promise.all(
    attempts.map(async (attempt) => {
      if (!attempt.list) return;
      const persona = byName.get(attempt.persona)!;
      try {
        attempt.marks = await judgeList(at, persona, attempt.list, now);
        attempt.score = scoreList(persona, attempt.list, attempt.marks);
      } catch (error) {
        attempt.error = `judge: ${String(error).slice(0, 300)}`;
      }
    }),
  );
  const out = join(CACHE, 'runs', `find-${opts.label}-${opts.set}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'find.json'), `${JSON.stringify({ label: opts.label, set: opts.set, model: opts.model, thinking: opts.thinking ?? 'default', prompt: instructions, cost, attempts }, null, 1)}\n`);
  report(attempts, cost, people, opts.model);
  console.log(`saved ${out}/find.json`);
}

function report(attempts: FindAttempt[], cost: Cost | undefined, people: Persona[], model: string) {
  const scored = attempts.filter((a) => a.score);
  // An aggregate over one held-out person is that person's result.
  const heldout = new Set(people.filter((persona) => persona.heldout).map((persona) => persona.name));
  const heldoutScored = new Set(scored.filter((a) => heldout.has(a.persona)).map((a) => a.persona)).size;
  if (heldout.size && heldoutScored < MIN_HELDOUT_PEOPLE) {
    console.log(`${heldoutScored} held-out people scored, fewer than ${MIN_HELDOUT_PEOPLE}: their aggregate would show one person's result, so none is shown`);
    return;
  }
  const sum = (f: (s: ListScore) => number) => scored.reduce((t, a) => t + f(a.score!), 0);
  for (const persona of people) {
    // A held-out person's results stay unread (README, Held-out personas).
    if (persona.heldout) continue;
    const mine = scored.filter((a) => a.persona === persona.name);
    if (!mine.length) continue;
    const parts = mine.map((a) => `${a.score!.found}/${a.score!.work} found, ${a.score!.unreal} unreal of ${a.score!.listed}`);
    console.log(`- ${persona.name}: ${parts.join('; ')}`);
  }
  // Every list the model answered, judged or not.
  const ms = attempts.flatMap((a) => (a.ms === undefined ? [] : [a.ms]));
  console.log(
    `found ${sum((s) => s.found)} of ${sum((s) => s.work)} work streams (${((100 * sum((s) => s.found)) / Math.max(1, sum((s) => s.work))).toFixed(0)}%), unreal ${(sum((s) => s.unreal) / Math.max(1, scored.length)).toFixed(1)} a list, duplicates ${sum((s) => s.duplicates)}; ${scored.length} of ${attempts.length} lists scored`,
  );
  // The author account may be writing a set at the same time: count only the finding model's spend.
  const usd = cost?.models[model.replace(/^[^/]*\//, "")];
  console.log(`cost ${usd === undefined && !cost ? 'unknown' : ((usd ?? 0) / Math.max(1, attempts.length)).toFixed(3)} a list on ${model}; median ${((quantile(ms, 0.5) || 0) / 1000).toFixed(0)} s of ${ms.length} lists`);
}
