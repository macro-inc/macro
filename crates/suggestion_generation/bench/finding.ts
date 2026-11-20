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
import { type MailStream, type Persona, WINDOW_DAYS, truthAt, windowMessages } from './personas';
import { obj, str, strs, write } from './heldout';
import { CACHE, type Cost, costOf, userId } from './run';

const JUDGE_MODEL = 'anthropic/claude-opus-5-5';
const AUTHOR = 'author@suggestions-bench.example';
/** The finding call's instructions. */
export const FIND_PROMPT = join(import.meta.dir, 'find.md');

const int = { type: 'integer' };

/** What the finding step answers. */
export type FoundStream = {
  name: string;
  senders: { name: string; email: string }[];
  count: number;
  cadence: string;
  what: string;
  action: string;
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
      handled_by: str,
      labels: strs,
      keeps: str,
      examples: strs,
    }),
  },
});

/** Labels every message in an inbox carries, which the finding call leaves out. */
const HIDDEN_LABELS = new Set(['INBOX', 'UNREAD']);

/** `text` as the finding call reads it (`suggestions/prompt.rs` `truncate`): on one line, cut to `max` characters, angle brackets swapped for look-alikes. */
function cut(text: string, max: number): string {
  return [...text.replace(/</g, '\u2039').replace(/>/g, '\u203A').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')]
    .slice(0, max)
    .join('');
}

/** The month's mail as the finding call reads it (`suggestions/work.rs` `line`): one line per message, newest first, the text of the newest under its line. */
export function mailText(persona: Persona, now: number): string {
  const lines = windowMessages(persona, 'full', now).messages.map((message) => {
    const labels = message.labels.filter((label) => !HIDDEN_LABELS.has(label)).slice(0, 5).map((label) => cut(label, 120));
    const from = message.from.name.trim() ? `${message.from.name} <${message.from.email}>` : message.from.email;
    const head = `${message.received_at.slice(0, 16).replace('T', ' ')} · ${cut(from, 120)} · ${cut(message.subject, 200)}${labels.length ? ` · ${labels.join(', ')}` : ''}`;
    const text = message.snippet?.trim();
    return text ? `${head}\n    ${cut(text, 500)}` : head;
  });
  return lines.join('\n');
}

export function findPrompt(instructions: string, persona: Persona, now: number): string {
  return `${instructions}
It is now ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC. Their mail of the last ${WINDOW_DAYS} days, newest first: a line per message (when, from, subject and labels), and the text of the newest 100 under its line.

<untrusted>
${mailText(persona, now)}
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

/** Match each listed stream to the key. */
export async function judgeList(at: Stack, persona: Persona, list: WorkList, now: number): Promise<EntryMark[]> {
  const key = truthAt(persona.streamsTruth!, now).streams;
  const prompt = `You check a list of work streams that a step found in one person's mail against the answer key: every stream of that mail, as it was written. Each key stream has an id and a kind: "work" is mail they act on, "noise" mail they read or ignore, "thread" a one-off conversation about one matter.

For each listed entry give its number n, and stream: the id of the key stream it describes (the same senders and the same kind of message), or "" when it describes none. An entry that covers part of a key stream describes that stream; one that merges several describes the one it mostly covers, and gives the other work streams it covers in full as also (else []). Say why in a few words. Mark strictly and the same way each time.

<key>
${keyText(key)}
</key>

<list>
${listText(list)}
</list>`;
  const marks = await write<{ entries: EntryMark[] }>(at, prompt, MARKS, JUDGE_MODEL);
  return marks.entries;
}

export type ListScore = { work: number; found: number; unreal: number; duplicates: number; listed: number; missed: string[] };

export function scoreList(persona: Persona, list: WorkList, marks: EntryMark[]): ListScore {
  const streams = persona.streamsTruth!.streams;
  const work = new Set(streams.filter((s) => s.kind === 'work').map((s) => s.id));
  const found = new Set<string>();
  let unreal = 0;
  let duplicates = 0;
  list.streams.forEach((_, i) => {
    const mark = marks.find((m) => m.n === i + 1);
    if (!mark || !work.has(mark.stream)) {
      unreal++;
      return;
    }
    if (found.has(mark.stream)) duplicates++;
    found.add(mark.stream);
    for (const id of mark.also) if (work.has(id)) found.add(id);
  });
  return { work: work.size, found: found.size, unreal, duplicates, listed: list.streams.length, missed: [...work].filter((id) => !found.has(id)) };
}

type FindAttempt = { persona: string; rep: number; list?: WorkList; ms?: number; marks?: EntryMark[]; score?: ListScore; error?: string };

/** Run the finding step `reps` times on each persona, then judge every list; the step's cost is the author's usage while it ran. */
export async function runFinding(at: Stack, people: Persona[], opts: { model: string; thinking?: 'low'; reps: number; label: string; set: string; prompt?: string; concurrency: number }) {
  const instructions = readFileSync(opts.prompt ?? FIND_PROMPT, 'utf8');
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
          attempt.list = await write<WorkList>(at, findPrompt(instructions, job.persona, now), WORK_LIST, opts.model, opts.thinking);
          attempt.ms = Date.now() - t0;
        } catch (error) {
          attempt.error = String(error).slice(0, 300);
        }
        attempts.push(attempt);
        console.log(`${job.persona.name} #${job.rep}: ${attempt.list ? `${attempt.list.streams.length} streams in ${((attempt.ms ?? 0) / 1000).toFixed(0)} s` : attempt.error}`);
      }
    }),
  );
  const db = new SQL(at.postgres);
  const cost: Cost = await costOf(db, userId(AUTHOR), started, new Date());
  await db.close();
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

function report(attempts: FindAttempt[], cost: Cost, people: Persona[], model: string) {
  const scored = attempts.filter((a) => a.score);
  const sum = (f: (s: ListScore) => number) => scored.reduce((t, a) => t + f(a.score!), 0);
  for (const persona of people) {
    const mine = scored.filter((a) => a.persona === persona.name);
    if (!mine.length) continue;
    const parts = mine.map((a) => `${a.score!.found}/${a.score!.work} found, ${a.score!.unreal} unreal of ${a.score!.listed}`);
    console.log(`- ${persona.name}: ${parts.join('; ')}`);
  }
  const ms = scored.map((a) => a.ms ?? 0).sort((a, b) => a - b);
  console.log(
    `found ${sum((s) => s.found)} of ${sum((s) => s.work)} work streams (${((100 * sum((s) => s.found)) / Math.max(1, sum((s) => s.work))).toFixed(0)}%), unreal ${(sum((s) => s.unreal) / Math.max(1, scored.length)).toFixed(1)} a list, duplicates ${sum((s) => s.duplicates)}; ${scored.length} of ${attempts.length} lists scored`,
  );
  // The author account may be writing a set at the same time: count only the finding model's spend.
  const usd = cost.models[model.replace(/^[^/]*\//, "")] ?? 0;
  console.log(`cost ${(usd / Math.max(1, attempts.length)).toFixed(3)} a list on ${model}; median ${((ms[Math.floor(ms.length / 2)] ?? 0) / 1000).toFixed(0)} s`);
}
