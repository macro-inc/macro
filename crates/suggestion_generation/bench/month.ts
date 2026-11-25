// Month personas: a held-out person with 30 days of mail, up to 500
// messages, the way the month read serves it (sender, subject and date of
// every message, text of the newest 100), and what they sent in the same
// days (text of the newest 50), for measuring a step that finds the
// recurring work in a whole month of mail. A person is written from a plan
// of every stream of their mail, which is also their streams key: the
// sketch, then the plan (each stream with what they do with its mail, in one
// word, and to whom), then each stream's messages (headers and a one-line
// gist of each), then the text of the newest 100, then their sent mail (a
// reply to or forward of some of the messages of each stream they answer or
// forward, by the plan's count, and the mail they start themselves), then
// the text of the newest sent, then the routines key from the streams and
// all of the mail. Its workspace is the owner and their colleagues only, and
// it has no feed key: it is for the routines section.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Stack } from '../../scheduled_action/bench/stack';
import { CATALOG } from './catalog';
import { ANCHOR } from './clock';
import { DOES, type Does, type InboxMessage, type MailStream, SENT_MESSAGES, SENT_TEXTS, type SentMessage, WINDOW_DAYS, WINDOW_MESSAGES, WINDOW_TEXTS } from './personas';
import { type WrittenRoutinesTruth, obj, placeAll, str, strs, takenPeople, takenWords, write } from './heldout';

export type MonthSketch = {
  mail: 'month';
  slug: string;
  persona: string;
  owner_first: string;
  owner_last: string;
  domain: string;
  timezone: string;
  labels: string[];
  colleagues: { first: string; last: string; role: string }[];
  situation: string;
  /** Messages that reach their inbox in a month, as sketched. */
  volume: number;
};

const int = { type: 'integer' };

const MONTH_SKETCH = obj({
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
      situation: str,
      volume: int,
    }),
  },
});

const PLANNED_STREAM = {
  name: str,
  senders: { type: 'array', items: obj({ name: str, email: str }) },
  count: int,
  cadence: str,
  what: str,
  action: str,
  does: { type: 'string', enum: [...DOES] },
  to: strs,
  sent: int,
  labels: strs,
};
const PLANNED = obj({ streams: { type: 'array', items: obj(PLANNED_STREAM) } });
const AROUND = obj({ streams: { type: 'array', items: obj({ kind: { type: 'string', enum: ['noise', 'thread'] }, ...PLANNED_STREAM }) } });

/** A planned stream: written with what they do with its mail, to whom, and how many they sent. */
type Planned = Omit<MailStream, 'id' | 'kind' | 'examples' | 'does' | 'to' | 'sent'> & { does: Does; to: string[]; sent: number };

const HEADERS = obj({
  messages: {
    type: 'array',
    items: obj({ date: str, from_name: str, from_email: str, to: strs, cc: strs, subject: str, labels: strs, gist: str }),
  },
});

type Header = { date: string; from_name: string; from_email: string; to: string[]; cc: string[]; subject: string; labels: string[]; gist: string };

const SENT_HEADERS = obj({ messages: { type: 'array', items: obj({ date: str, to: strs, cc: strs, subject: str, gist: str }) } });

const TEXTS = obj({ texts: { type: 'array', items: obj({ n: int, snippet: str }) } });

const NEEDS = obj({
  needs: { type: 'array', items: obj({ id: str, what: str, streams: strs, evidence: strs, catalog: strs, drafted: str, surfaces: strs }) },
});
const DECOYS = obj({
  decoys: { type: 'array', items: obj({ id: str, what: str, why: str, catalog: strs }) },
  misfit: strs,
});

/** Messages a call writes at most: the harness gives a structured completion 90 seconds. */
const HEADERS_PER_CALL = 25;
const TEXTS_PER_CALL = 10;
/** Model calls in flight per person. */
const CALLS = 4;
/** The fewest messages a month keeps in the window: half the read, or it is not a month of real work. */
const MIN_MONTH_MESSAGES = WINDOW_MESSAGES / 2;
/** `labels` with INBOX among them: every message of a month is written to the inbox. */
export const inInbox = (labels: string[]) => (labels.includes('INBOX') ? labels : ['INBOX', ...labels]);

/**
 * The needs only a drafted routine meets, counted once each by id: a need
 * whose drafted routine is blank counts for none, and so does one a catalog
 * routine the catalog has meets on its own.
 */
export function draftableNeeds(needs: { id: string; drafted?: string; catalog?: string[] }[]): number {
  return new Set(needs.filter((need) => need.drafted?.trim() && !(need.catalog ?? []).some((key) => Object.hasOwn(CATALOG, key))).map((need) => need.id)).size;
}

/** The fewest needs only a drafted routine can meet, so five good drafts are a fair target (5 for sets written before sent mail). */
const MIN_DRAFTED_NEEDS = 8;
/** How many times a person's needs are written from the same mail before the person is given up. */
const KEY_TRIES = 3;
/** The soonest and latest a reply or forward follows the message it answers. */
const SENT_DELAY_MS = [20 * 60_000, 9 * 60 * 60_000] as const;

const DAY_MS = 24 * 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
/** `ms` as the writers date mail: to the second. */
const dated = (ms: number) => iso(ms).replace(/\.\d{3}Z$/, 'Z');

/** How long after a message its reply or forward went, the same for the same `seed` every time. */
export function sentDelay(seed: string): number {
  const share = Number(BigInt(Bun.hash(seed)) % 1_000_000n) / 1_000_000;
  return Math.round(SENT_DELAY_MS[0] + share * (SENT_DELAY_MS[1] - SENT_DELAY_MS[0]));
}

/** A reply's subject: the message's, with one "Re:" before it. */
export const replySubject = (subject: string) => (/^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`);

/**
 * Which `count` of a stream's `messages` (oldest first) got a reply or a
 * forward: spread evenly over them, so a month's answered mail runs through
 * it as the plan's cadence does.
 */
export function followedUp<T>(messages: T[], count: number): T[] {
  const n = Math.min(Math.max(0, count), messages.length);
  return Array.from({ length: n }, (_, k) => messages[Math.floor(((k + 0.5) * messages.length) / n)]);
}
const anchor = iso(ANCHOR);
const windowStart = ANCHOR - WINDOW_DAYS * DAY_MS;

/**
 * `jobs` run `CALLS` at a time, in order of their results. After a job
 * fails none starts, and the failure is thrown once the running ones end, so
 * nothing of this person is still being written when the next begins.
 */
export async function pooled<T>(jobs: (() => Promise<T>)[], calls = CALLS): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < jobs.length) {
      const i = next++;
      try {
        results[i] = await jobs[i]();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const ended = await Promise.allSettled(Array.from({ length: Math.min(calls, jobs.length) }, worker));
  const rejected = ended.find((end): end is PromiseRejectedResult => end.status === 'rejected');
  if (rejected) throw rejected.reason;
  return results;
}

export async function sketchMonth(at: Stack, count: number): Promise<MonthSketch[]> {
  const tune = takenPeople();
  const { people } = await write<{ people: Omit<MonthSketch, 'mail'>[] }>(
    at,
    `Invent ${count} people whose work runs through their inbox, many kinds of it arriving every week (requests, orders, bills, bookings, applications, reports, notices from their tools that need a step), who would use a work app with email, tasks, documents, chat channels, calls, a CRM and calendar. Each runs or works in a small organization; make them differ from each other in industry, role, seniority and how they work, and differ from these existing ones: ${tune.join(' | ')}.
For each: a short slug (lowercase letters), a one-sentence persona, a first and last name, an invented company domain ending in .example, an IANA time zone in the Americas or Europe, the 4 to 7 mail labels they file mail under, 4 colleagues, a situation (what is going on in their work this month), and volume: how many messages reach their inbox in a month, 250 to 500. ${takenWords()}`,
    MONTH_SKETCH,
  );
  return people.map((person) => ({ ...person, mail: 'month' as const }));
}

/** Write one month persona: its mailbox, an owner-only workspace, and its streams and routines keys. */
export async function writeMonthPersona(at: Stack, name: string, root: string, sketch: MonthSketch) {
  const dir = join(root, `.${sketch.slug}.partial`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const owner = { name: `${sketch.owner_first} ${sketch.owner_last}`, email: `${sketch.owner_first.toLowerCase()}@${sketch.domain}` };
  const colleagues = sketch.colleagues.map((c) => `${c.first} ${c.last} (${c.role}, ${c.first.toLowerCase()}@${sketch.domain})`).join('; ');
  const who = `${owner.name} <${owner.email}>: ${sketch.persona} Labels they file under: ${sketch.labels.join(', ')}. Colleagues: ${colleagues}. This month: ${sketch.situation}`;
  const catalogText = Object.entries(CATALOG).map(([key, e]) => `${key}: ${e.does} (${e.surfaces.join(', ')})`).join('\n');
  const rules = `Senders keep one name and address throughout; every name, company and address is invented, addresses end in .example, colleagues write from ${sketch.domain}. labels: the person's own labels where they would file it (${sketch.labels.join(', ')}), CATEGORY_UPDATES or CATEGORY_PROMOTIONS for automated mail, none for plain conversation.`;

  // The plan: work streams first, then what else reaches the inbox around them.
  const { streams: work } = await write<{ streams: Planned[] }>(
    at,
    `Plan the recurring work in the mail of ${who}
It is now ${anchor}. In the ${WINDOW_DAYS} days before now, about ${sketch.volume} messages reached their inbox. Plan the work streams among them: 12 to 18 streams of recurring mail they act on, where each message asks them for a step or feeds work they do (orders, invoices, requests, bookings, applications, reports they act on, tool notifications that need a step), and the recurring mail they start themselves (a weekly report, an invoice run, chasing late replies). Vary them: different senders, 3 to 80 messages each, together about three quarters of the mail. At least ten of them are work this ready-made catalog doesn't do the way they do it, so only a routine written for them would:
${catalogText}
For each: a name, its senders (for mail they start, who answers it), count (messages of it that reach their inbox in the ${WINDOW_DAYS} days; for mail they start, the replies, which may be 0), cadence (how often and when), what each message says, action (what they do with each message, and, where someone or something else already handles it, who: a colleague who runs it and reports, a tool that already reminds them), does (in one word: answers, they reply to the sender; forwards, they send it on to someone; files, they label or save it and send nothing; leaves, a colleague or a tool handles it and they send nothing; nothing, they only read it; sends, they start this mail themselves), to (whom they forward it to, who handles it for them, or whom they send it to: addresses; empty otherwise), sent (how many messages of it they sent in the ${WINDOW_DAYS} days: replies or forwards, up to count, or the mail they started; 0 when they send none), and labels. Make at least three streams they answer, two they forward, two they start themselves, and two someone or something else handles.
${rules}`,
    PLANNED,
  );
  const workCount = work.reduce((n, s) => n + s.count, 0);
  const { streams: around } = await write<{ streams: (Planned & { kind: string })[] }>(
    at,
    `Plan the rest of the mail of ${who}
It is now ${anchor}. In the ${WINDOW_DAYS} days before now, about ${sketch.volume} messages reached their inbox. These work streams are planned (${workCount} messages): ${work.map((s) => `${s.name} (${s.count}, from ${s.senders.map((x) => x.email).join(', ')})`).join('; ')}.
Plan the other ${Math.max(40, sketch.volume - workCount)} or so messages, none of them more of the work streams: 4 to 8 noise streams of recurring mail they read or ignore (newsletters, promotions, receipts, product updates, social), with kind "noise", and 8 to 15 one-off conversations about a single matter each (2 to 8 messages), with kind "thread", together about a sixth of the mail. For each: kind, a name, its senders, count (messages in the ${WINDOW_DAYS} days), cadence (for a thread: over how many days), what its messages say, action (what they do with it), does (answers, forwards, files, leaves, nothing; most threads they answer, noise they leave be or file), to (whom they forward it to or who handles it: addresses; empty otherwise), sent (how many messages of it they sent: replies or forwards, up to count; 0 for noise), and labels.
${rules}`,
    AROUND,
  );
  const plan: (Planned & { id: string; kind: MailStream['kind'] })[] = [
    ...work.map((s) => ({ ...s, kind: 'work' as const })),
    ...around.map((s) => ({ ...s, kind: s.kind as MailStream['kind'] })),
  ]
    .map((s) => ({ ...s, count: Math.max(0, s.count), sent: Math.max(0, s.sent ?? 0), to: s.to ?? [] }))
    // Mail they start may get no reply: what they sent is the stream.
    .filter((s) => s.count > 0 || (s.does === 'sends' && s.sent > 0))
    .map((s, i) => ({ ...s, id: `s${i + 1}` }));
  const planText = plan.map((s) => `${s.id} (${s.kind}) ${s.name}: ${s.count} from ${s.senders.map((x) => `${x.name} <${x.email}>`).join(', ')}; they ${s.does}${s.to.length ? ` (${s.to.join(', ')})` : ''}, ${s.sent} sent`).join('\n');

  // Each stream's messages, a slice of its window at a time: the newest slice first.
  const jobs = plan.flatMap((stream) => {
    if (!stream.count) return [];
    const parts = Math.ceil(stream.count / HEADERS_PER_CALL);
    return Array.from({ length: parts }, (_, part) => async () => {
      const n = Math.round((stream.count * (part + 1)) / parts) - Math.round((stream.count * part) / parts);
      // A thread is a conversation somewhere in the window; a stream spreads over it.
      const to = stream.kind === 'thread' ? ANCHOR : ANCHOR - (WINDOW_DAYS * DAY_MS * part) / parts;
      const from = stream.kind === 'thread' ? windowStart : ANCHOR - (WINDOW_DAYS * DAY_MS * (part + 1)) / parts;
      const { messages } = await write<{ messages: Header[] }>(
        at,
        `Write ${n} messages${parts > 1 ? ` (part ${part + 1} of ${parts})` : ''} of one stream of mail in the inbox of ${who}
It is now ${anchor}. The stream, ${stream.id}: ${stream.name}. Senders: ${stream.senders.map((x) => `${x.name} <${x.email}>`).join(', ')}. ${stream.count} messages in the ${WINDOW_DAYS} days before now, ${stream.cadence}. Each says: ${stream.what}. What they do with it: ${stream.action}${stream.does === 'sends' ? ' (these are the replies to the mail they send)' : ''}. Labels: ${stream.labels.join(', ') || 'none'}.
Date these ${n} between ${iso(from)} and ${iso(Math.min(to, ANCHOR - 60_000))} (ISO timestamps in UTC)${stream.kind === 'thread' ? ', as one conversation over the days its cadence says, its replies starting "Re:"' : ', spread as its cadence says, at the hours such mail comes'}. Each message: date, sender name and address (one of the stream's senders), to and cc (the owner, ${owner.email}, among them), subject (varied as real ones are: ids, names, dates), labels (INBOX, the stream's labels, UNREAD on a few from the last two days), and gist: one line with this message's particulars (names, ids, amounts, dates and what it asks), from which its text is written later.
${rules}
The other streams of this inbox, so this one stays apart from them:
${planText}`,
        HEADERS,
      );
      return messages.map((m) => ({ ...m, stream: stream.id }));
    });
  });
  const headers = (await pooled(jobs)).flat();

  // Keep what fits the window and the read: dated in it, newest first, at most WINDOW_MESSAGES.
  // Every message is the inbox's, as the read the finding step makes and the minimum both count it.
  const kept = headers
    .map((m) => ({ ...m, labels: inInbox(m.labels), at: Date.parse(m.date) }))
    .filter((m) => Number.isFinite(m.at) && m.at > windowStart && m.at < ANCHOR)
    .sort((a, b) => b.at - a.at)
    .slice(0, WINDOW_MESSAGES);
  if (kept.length < MIN_MONTH_MESSAGES) throw new Error(`${sketch.slug}: only ${kept.length} of ${headers.length} messages were dated in the window, fewer than ${MIN_MONTH_MESSAGES}`);

  // The text of the newest WINDOW_TEXTS, ten at a time.
  const byId = new Map(plan.map((s) => [s.id, s]));
  const newest = kept.slice(0, WINDOW_TEXTS);
  const texts = new Map<number, string>();
  await pooled(
    Array.from({ length: Math.ceil(newest.length / TEXTS_PER_CALL) }, (_, part) => async () => {
      const batch = newest.slice(part * TEXTS_PER_CALL, (part + 1) * TEXTS_PER_CALL);
      const listed = batch
        .map((m, i) => {
          const s = byId.get(m.stream)!;
          return `${part * TEXTS_PER_CALL + i + 1}. ${m.date} from ${m.from_name} <${m.from_email}> | ${m.subject}\n   stream: ${s.name} (${s.what}) | gist: ${m.gist}`;
        })
        .join('\n');
      const { texts: written } = await write<{ texts: { n: number; snippet: string }[] }>(
        at,
        `Write the opening of each of these emails in the inbox of ${who}
It is now ${anchor}. For each, by its number: the first 300 to 500 characters of its body, as its sender would write it, carrying its gist (names, ids, amounts, dates, what it asks); automated mail reads like the tool that sends it. Every name, company and address is invented; addresses end in .example.
${listed}`,
        TEXTS,
      );
      // Exactly this batch's numbers, each once and with text: another batch's number would overwrite its text.
      const own = batch.map((_, i) => part * TEXTS_PER_CALL + i + 1);
      const numbers = written.map((t) => t.n).sort((a, b) => a - b);
      if (numbers.join() !== own.join() || written.some((t) => !t.snippet.trim())) {
        throw new Error(`${sketch.slug}: texts for ${own[0]}–${own.at(-1)} came back numbered ${numbers.join(', ')}${written.some((t) => !t.snippet.trim()) ? ', some blank' : ''}`);
      }
      for (const t of written) texts.set(t.n - 1, t.snippet);
    }),
  );
  const untexted = newest.map((_, i) => i).filter((i) => !texts.get(i));
  if (untexted.length) throw new Error(`${sketch.slug}: ${untexted.length} of the newest ${WINDOW_TEXTS} came back without text`);

  const messages: InboxMessage[] = kept.map((m, i) => ({
    from: { name: m.from_name, email: m.from_email },
    to: m.to,
    cc: m.cc,
    date: m.date,
    subject: m.subject,
    labels: m.labels,
    snippet: texts.get(i) ?? '',
    stream: m.stream,
  }));

  // Their sent mail: for each stream they answer or forward, a reply to or
  // forward of the plan's count of its messages, some time after each (one
  // that would come after now isn't sent yet); and the mail they start, which
  // a model dates and outlines as it does a stream's messages.
  type Outgoing = { at: number; to: string[]; cc: string[]; subject: string; stream: string; kind: SentMessage['kind']; gist?: string; answering?: number };
  const colleague = sketch.colleagues[0] ? `${sketch.colleagues[0].first.toLowerCase()}@${sketch.domain}` : owner.email;
  const followed: Outgoing[] = plan.flatMap((stream) => {
    if (stream.does !== 'answers' && stream.does !== 'forwards') return [];
    const own = kept.map((m, i) => ({ m, i })).filter(({ m }) => m.stream === stream.id).reverse();
    return followedUp(own, stream.sent).flatMap(({ m, i }): Outgoing[] => {
      const at = m.at + sentDelay(`${sketch.slug} ${stream.id} ${m.date} ${m.subject}`);
      if (at >= ANCHOR - 60_000) return [];
      if (stream.does === 'forwards') return [{ at, to: stream.to.length ? stream.to : [colleague], cc: [], subject: `Fwd: ${m.subject}`, stream: stream.id, kind: 'forward', answering: i }];
      const cc = m.cc.filter((address) => address.toLowerCase() !== owner.email.toLowerCase());
      return [{ at, to: [m.from_email], cc, subject: replySubject(m.subject), stream: stream.id, kind: 'reply', answering: i }];
    });
  });
  const startJobs = plan.flatMap((stream) => {
    if (stream.does !== 'sends' || !stream.sent) return [];
    const parts = Math.ceil(stream.sent / HEADERS_PER_CALL);
    return Array.from({ length: parts }, (_, part) => async (): Promise<Outgoing[]> => {
      const n = Math.round((stream.sent * (part + 1)) / parts) - Math.round((stream.sent * part) / parts);
      const to = ANCHOR - (WINDOW_DAYS * DAY_MS * part) / parts;
      const from = ANCHOR - (WINDOW_DAYS * DAY_MS * (part + 1)) / parts;
      const { messages: started } = await write<{ messages: { date: string; to: string[]; cc: string[]; subject: string; gist: string }[] }>(
        at,
        `Write ${n} messages${parts > 1 ? ` (part ${part + 1} of ${parts})` : ''} that ${owner.name} <${owner.email}> started themselves, of one stream of their work. Who they are: ${who}
It is now ${anchor}. The stream, ${stream.id}: ${stream.name}. They send it to ${stream.to.join(', ') || 'the people it is for'}. ${stream.sent} messages in the ${WINDOW_DAYS} days before now, ${stream.cadence}. Each says: ${stream.what}. What they do: ${stream.action}.
Date these ${n} between ${iso(from)} and ${iso(Math.min(to, ANCHOR - 60_000))} (ISO timestamps in UTC), spread as its cadence says, at the hours they would send it. Each message: date, to and cc (addresses), subject (varied as real ones are: ids, names, dates), and gist: one line with this message's particulars (names, ids, amounts, dates and what it asks), from which its text is written later.
${rules}`,
        SENT_HEADERS,
      );
      return started.map((m) => ({ at: Date.parse(m.date), to: m.to, cc: m.cc, subject: m.subject, gist: m.gist, stream: stream.id, kind: 'new' as const }));
    });
  });
  const outgoing = [...followed, ...(await pooled(startJobs)).flat()]
    .filter((m) => Number.isFinite(m.at) && m.at > windowStart && m.at < ANCHOR)
    .sort((a, b) => b.at - a.at)
    .slice(0, SENT_MESSAGES);

  // The text of the newest SENT_TEXTS they sent, ten at a time: what they decided, asked or passed on.
  const newestSent = outgoing.slice(0, SENT_TEXTS);
  const sentTexts = new Map<number, string>();
  await pooled(
    Array.from({ length: Math.ceil(newestSent.length / TEXTS_PER_CALL) }, (_, part) => async () => {
      const batch = newestSent.slice(part * TEXTS_PER_CALL, (part + 1) * TEXTS_PER_CALL);
      const listed = batch
        .map((m, i) => {
          const s = byId.get(m.stream)!;
          const original = m.answering === undefined ? undefined : kept[m.answering];
          const about = original
            ? `${m.kind === 'reply' ? 'their reply to' : 'their forward of'} ${original.from_name} <${original.from_email}>: ${original.gist}${texts.get(m.answering!) ? ` (it opens: ${texts.get(m.answering!)!.slice(0, 300)})` : ''}`
            : `mail they start: ${m.gist}`;
          return `${part * TEXTS_PER_CALL + i + 1}. ${dated(m.at)} to ${m.to.join(', ')}${m.cc.length ? ` cc ${m.cc.join(', ')}` : ''} | ${m.subject}\n   ${about}\n   stream: ${s.name}; what they do with it: ${s.action}`;
        })
        .join('\n');
      const { texts: written } = await write<{ texts: { n: number; snippet: string }[] }>(
        at,
        `Write the opening of each of these emails that ${who.split(':')[0]} sent.
It is now ${anchor}. For each, by its number: the first 150 to 400 characters of its body, as they would write it: for a reply, their answer (what they decide, confirm, ask or send back); for a forward, the note they write above the forwarded message to the person they send it to; for mail they start, its opening. Carry its particulars (names, ids, amounts, dates) and what they do with that stream's mail. Every name, company and address is invented; addresses end in .example.
${listed}`,
        TEXTS,
      );
      const own = batch.map((_, i) => part * TEXTS_PER_CALL + i + 1);
      const numbers = written.map((w) => w.n).sort((a, b) => a - b);
      if (numbers.join() !== own.join() || written.some((w) => !w.snippet.trim())) {
        throw new Error(`${sketch.slug}: sent texts for ${own[0]}–${own.at(-1)} came back numbered ${numbers.join(', ')}${written.some((w) => !w.snippet.trim()) ? ', some blank' : ''}`);
      }
      for (const w of written) sentTexts.set(w.n - 1, w.snippet);
    }),
  );
  const sent: SentMessage[] = outgoing.map((m, i) => ({
    from: owner,
    to: m.to,
    cc: m.cc,
    date: dated(m.at),
    subject: m.subject,
    labels: ['SENT'],
    snippet: sentTexts.get(i) ?? '',
    stream: m.stream,
    kind: m.kind,
  }));

  const inbox = { owner, persona: sketch.persona, timezone: sketch.timezone, messages, sent };
  writeFileSync(join(dir, 'inbox.json'), `${JSON.stringify(inbox, null, 1)}\n`);

  // The streams key: the plan, with what was written of each.
  const streams: MailStream[] = plan
    .map((s) => {
      const own = messages.filter((m) => m.stream === s.id);
      const theirs = sent.filter((m) => m.stream === s.id);
      // The senders of the messages counted, as the finding judge matches entries by them.
      const senders = [...new Map(own.map((m) => [m.from.email.toLowerCase(), m.from])).values()];
      return {
        id: s.id,
        kind: s.kind,
        name: s.name,
        senders,
        count: own.length,
        cadence: s.cadence,
        what: s.what,
        action: s.action,
        does: s.does,
        to: s.to,
        sent: theirs.length,
        labels: s.labels,
        examples: (own.length ? own : theirs).slice(0, 4).map((m) => m.subject),
      };
    })
    .filter((s) => s.count > 0 || s.sent > 0);
  writeFileSync(join(dir, 'streams-truth.json'), `${JSON.stringify({ streams }, null, 1)}\n`);

  // The routines key, from the streams and the mail as the judge reads it.
  const digest = messages.map((m, i) => `[${i + 1}] ${m.date} ${m.from.email} | ${m.subject} | ${m.labels.join(',')}${m.snippet ? `\n${m.snippet}` : ''}`).join('\n');
  const sentDigest = sent.map((m, i) => `[S${i + 1}] ${m.date} to ${m.to.join(', ')} | ${m.subject}${m.snippet ? `\n${m.snippet}` : ''}`).join('\n');
  const streamsText = streams
    .map((s) => `${s.id} (${s.kind}) ${s.name}: ${s.count} messages, ${s.cadence}, from ${s.senders.map((x) => x.email).join(', ') || 'none'}. Each: ${s.what}. They: ${s.action} (${s.does}${s.to?.length ? ` ${s.to.join(', ')}` : ''}; ${s.sent} sent)`)
    .join('\n');
  const catalog = Object.entries(CATALOG).map(([key, e]) => `${key}: ${e.does} (${e.surfaces.join(', ')})`).join('\n');
  const context = `It is now ${anchor}. The streams of their mail in the ${WINDOW_DAYS} days before now:
${streamsText}
Catalog:
${catalog}
Their mail, newest first (text for the newest ${WINDOW_TEXTS}; sender, subject and labels for the rest):
<mail>${digest}</mail>
What they sent in those days, newest first (text for the newest ${SENT_TEXTS}):
<mail>${sentDigest}</mail>`;
  type Need = WrittenRoutinesTruth['needs'][number] & { id: string; what: string; streams: string[] };
  const ids = new Set(streams.map((s) => s.id));
  // A need rests on streams that were kept, or no mail shows it. It is left out before
  // placing, so the catalog keys it named aren't counted as met.
  const onKeptStreams = (needs: Need[]) =>
    needs
      .map((need) => ({ ...need, streams: (need.streams ?? []).filter((id) => ids.has(id)), drafted: need.drafted?.trim() || undefined }))
      .filter((need) => need.streams.length);
  // Five good drafted routines must be within reach. The needs are written again from
  // the same mail when too few are left to drafts, before any decoy or build sees them.
  let needs: Need[] = [];
  let shown: ReturnType<typeof onKeptStreams> = [];
  for (let attempt = 1; ; attempt++) {
    ({ needs } = await write<{ needs: Need[] }>(
      at,
    `Write the needs of the answer key for judging automations ("routines") suggested to ${owner.name} a minute after signup, from their mail alone. Who they are: ${sketch.persona}
A need is a routine they would still have on a month later because a stream of their mail shows the work: one for each work stream, or several that make one job, where a routine would do real work for them, the way they handle that mail. Leave out streams someone or something else already handles for them and streams too thin to automate. Ids r1, r2, …; for each: what, streams (the stream ids it rests on), evidence (3 to 5 subjects from the mail), the catalog keys that meet it on their own (empty when only a drafted routine can), drafted (what a drafted routine that meets it does; empty when the catalog covers it), and surfaces (sidebars it belongs in, best first: email, calendar, tasks, files, crm, chat, calls, reviews, agents). Make one need "mail sorting" met by inbox or email_tags when they file mail under labels.
${context}`,
      NEEDS,
    ));
    shown = onKeptStreams(needs);
    const draftable = draftableNeeds(shown);
    if (draftable >= MIN_DRAFTED_NEEDS) break;
    // A held-out person's counts are theirs: neither is printed.
    if (attempt === KEY_TRIES) throw new Error(`each of ${KEY_TRIES} keys left fewer than ${MIN_DRAFTED_NEEDS} needs only a drafted routine meets`);
    console.error(`a key left fewer than ${MIN_DRAFTED_NEEDS} needs only a drafted routine meets; writing its needs again`);
  }
  const { decoys, misfit } = await write<{ decoys: WrittenRoutinesTruth['decoys']; misfit: string[] }>(
    at,
    `Write the decoys and misfits of the answer key for judging automations ("routines") suggested to ${owner.name} a minute after signup, from their mail alone. Who they are: ${sketch.persona}
Its needs are written: ${needs.map((n) => `${n.id}: ${n.what}`).join(' | ')}.
Decoys (ids x1, …, 3 to 6): routines that look plausible from their mail but that they would switch off, with why, and the catalog keys that are that decoy (empty when none): routines for streams someone or something else already handles, for noise they ignore, and one that would send or act as them. Misfit: every catalog key that would do nothing for how this person works (a deal pipeline for someone with no deals, call recaps for someone whose work never happens on calls); a part of the app they haven't used yet is not a misfit for that reason alone. Every catalog key the needs and decoys leave out, and you leave out of misfit, counts as fine for them.
${context}`,
    DECOYS,
  );
  const placed = placeAll({ needs: shown, decoys, misfit });
  writeFileSync(join(dir, 'routines-truth.json'), `${JSON.stringify(placed, null, 1)}\n`);

  const users = Object.fromEntries([
    ['owner', { email: owner.email, first_name: sketch.owner_first, last_name: sketch.owner_last, roles: ['team_subscriber', 'sub_opus'] }],
    ...sketch.colleagues.map((c) => [c.first.toLowerCase(), { email: `${c.first.toLowerCase()}@${sketch.domain}`, first_name: c.first, last_name: c.last }]),
  ]);
  const workspace = {
    scenario: `sugbench-h-${sketch.slug}`,
    description: `${sketch.persona} (held-out month set ${name})`,
    users,
    teams: { [sketch.slug]: { name: sketch.domain.replace(/\.example$/, ''), owner: 'owner', members: Object.fromEntries(sketch.colleagues.map((c) => [c.first.toLowerCase(), 'member'])) } },
  };
  writeFileSync(join(dir, 'workspace.json'), `${JSON.stringify(workspace, null, 1)}\n`);
  renameSync(dir, join(root, sketch.slug));
  console.log('wrote a month persona');
}
