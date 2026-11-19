// The people the bench generates suggestions for. Each persona is a folder:
// `workspace.json` (a seed scenario without mail: users, team, projects,
// documents, tasks, channels, calls), `inbox.json` (100 messages as a mail
// provider lists them, labels included) and the answer keys,
// `feed-truth.json` and `routines-truth.json`. The tune personas live in
// `personas/`; held-out ones live outside the repository (see heldout.ts).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ANCHOR, shiftAll, shiftDays } from './clock';

export const TUNE_DIR = join(import.meta.dir, 'personas');
export const HELDOUT_DIR = join(homedir(), '.cache/suggestions-bench/heldout');

export type InboxMessage = {
  from: { name: string; email: string };
  to: string[];
  cc: string[];
  /** When it arrived, written for the anchor evening. */
  date: string;
  subject: string;
  labels: string[];
  snippet: string;
};

export type Inbox = {
  owner: { name: string; email: string };
  persona: string;
  /** The owner's time zone, which generations are started in. */
  timezone: string;
  messages: InboxMessage[];
};

/** Something a good feed brings up, and what it should say. */
export type FeedPlanted = { id: string; what: string; evidence: string[]; ideal_suggestion: string };
/** Something that looks worth a card but the workspace shows is handled. */
export type Decoy = { id: string; what: string; why_stale: string };
export type FeedTruth = { planted: FeedPlanted[]; decoys: Decoy[] };

/** A routine this person would keep, and how the bench recognises one that meets it. */
export type RoutineNeed = {
  id: string;
  what: string;
  /** Subjects of the inbox messages that show it, so a reviewer can check it. */
  evidence: string[];
  /** Catalog routines that meet it on their own; empty when only a drafted routine can. */
  catalog: string[];
  /** What a drafted routine that meets it does, when the catalog lacks it. */
  drafted?: string;
  /** Sidebars it belongs in, best first. */
  surfaces: string[];
};
/** A routine that looks plausible for this person but that they wouldn't keep. */
export type RoutineDecoy = { id: string; what: string; why: string; catalog?: string[] };
/**
 * Every catalog routine sorts into one place in the key: the needs that list
 * it, a decoy that lists it, `fine` (it suits the person but meets no need:
 * it counts nothing) or `misfit` (it does nothing for how they work). The
 * bench scores catalog picks from this alone, so they score the same every
 * time; a drafted routine is the judge's call.
 */
export type RoutinesTruth = { needs: RoutineNeed[]; decoys: RoutineDecoy[]; fine: string[]; misfit: string[] };

export type Persona = {
  name: string;
  /**
   * Which copy of the person: copies 2 and up live under a domain of their
   * own (`-s2`), so several attempts at one person run side by side.
   */
  seat: number;
  heldout: boolean;
  dir: string;
  workspace: Record<string, unknown> & { scenario: string; description: string; users: Record<string, { email: string }> };
  inbox: Inbox;
  feedTruth?: FeedTruth;
  routinesTruth?: RoutinesTruth;
};

// A held-out writer makes addresses from first names, so one may carry an
// accent ("inès@…") or another script, which the seed CLI refuses. Each such
// address is read with its local part spelled in ASCII, the same way in every
// file of the persona (its mail, its workspace and its answer keys): without
// its accents (and without the empty dot runs that can leave), or tagged with
// its original spelling where that would leave it empty or the same as
// another address of the persona. Files are parsed first, so an escaped
// spelling ("in\\u00e8s") reads the same. An apostrophe inside a local part
// ("o'neil") belongs to it; one around an address quotes it, as brackets do.
const ADDRESS = /([^\s<>"',;:()@[\]]+(?:'+[^\s<>"',;:()@[\]]+)*)@([\w.-]+\.\w+)/gu;
const isAscii = (text: string) => /^[\x21-\x7e]*$/.test(text);

const strings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, inner]) => [key, ...strings(inner)]);
  return [];
};

const mapStrings = (value: unknown, f: (text: string) => string): unknown => {
  if (typeof value === 'string') return f(value);
  if (Array.isArray(value)) return value.map((inner) => mapStrings(inner, f));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [f(key), mapStrings(inner, f)]));
  return value;
};

/** Each address in `values` whose local part isn't ASCII, and how it is spelled instead. */
export function asciiSpellings(values: unknown[]): Map<string, string> {
  const addresses = [...new Set(values.flatMap(strings).flatMap((text) => [...text.matchAll(ADDRESS)].map((match) => match[0])))].sort();
  const taken = new Set(addresses.filter((address) => isAscii(address.split('@')[0])).map((address) => address.toLowerCase()));
  const spelled = new Map<string, string>();
  for (const address of addresses.filter((address) => !isAscii(address.split('@')[0]))) {
    const [local, domain] = address.split('@');
    const plain = local
      .normalize('NFD')
      .replace(/[^\x21-\x7e]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+|\.+$/g, '');
    let ascii = `${plain}@${domain}`;
    // A tag hashes the original spelling, then that with a counter until it is free.
    for (let n = 0; !plain || taken.has(ascii.toLowerCase()); n++) {
      ascii = `${plain || 'x'}-${Bun.hash(n ? `${local}#${n}` : local).toString(36).slice(0, 6)}@${domain}`;
      if (!taken.has(ascii.toLowerCase())) break;
    }
    taken.add(ascii.toLowerCase());
    spelled.set(address, ascii);
  }
  return spelled;
}

/** `value` with every address in `spelled` spelled its way. */
export const spellAddresses = <T>(value: T, spelled: Map<string, string>): T =>
  spelled.size ? (mapStrings(value, (text) => text.replace(ADDRESS, (address) => spelled.get(address) ?? address)) as T) : value;

const readJson = <T>(path: string): T | undefined => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined);

function load(dir: string, name: string, heldout: boolean): Persona {
  const workspace = readJson<Persona['workspace']>(join(dir, 'workspace.json'));
  const inbox = readJson<Inbox>(join(dir, 'inbox.json'));
  if (!workspace || !inbox) throw new Error(`${dir} lacks workspace.json or inbox.json`);
  const feedTruth = readJson<FeedTruth>(join(dir, 'feed-truth.json'));
  const routinesTruth = readJson<RoutinesTruth>(join(dir, 'routines-truth.json'));
  const spelled = asciiSpellings([workspace, inbox, feedTruth, routinesTruth]);
  return {
    name,
    seat: 1,
    heldout,
    dir,
    workspace: spellAddresses(workspace, spelled),
    inbox: spellAddresses(inbox, spelled),
    feedTruth: spellAddresses(feedTruth, spelled),
    routinesTruth: spellAddresses(routinesTruth, spelled),
  };
}

/** What a generation for `persona` reads (its workspace and mail, as spelled here), as a short digest a rejudge checks it reads the same. */
export const personaDigest = (persona: Persona) => Bun.hash(JSON.stringify([persona.workspace, persona.inbox])).toString(36);

/** A set's people: its folders, leaving out the hidden ones a held-out writer is still filling. */
export const folders = (root: string) =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort()
    : [];

/** The tune personas, or the held-out set `set` (a folder under the held-out directory). */
export function personas(set: 'tune' | string): Persona[] {
  if (set === 'tune') return folders(TUNE_DIR).map((name) => load(join(TUNE_DIR, name), name, false));
  const root = join(HELDOUT_DIR, set);
  const listed = join(root, 'people.json');
  if (existsSync(listed)) {
    const missing = (JSON.parse(readFileSync(listed, 'utf8')) as { slug: string }[]).map((person) => person.slug).filter((slug) => !existsSync(join(root, slug)));
    if (missing.length) throw new Error(`held-out set ${set} is not finished (${missing.join(', ')}); run heldout make ${set} again first`);
  }
  const found = folders(root).map((name) => load(join(root, name), name, true));
  if (!found.length) throw new Error(`no held-out set ${set} in ${HELDOUT_DIR}; make one with \`heldout make\``);
  return found;
}

// ---------- variants ----------

/**
 * Which copy of a persona a section seeds. `full` is the whole workspace, as
 * after weeks of use; `signup` is the person a minute after signing up: their
 * mailbox and nothing else, under a domain of its own so both copies can
 * exist on one stack.
 */
export type Variant = 'full' | 'signup';

const domainOf = (email: string) => email.split('@')[1];

/** Copy `seat` of `persona`. */
export const seatOf = (persona: Persona, seat: number): Persona => ({ ...persona, seat });

const seatTag = (persona: Persona) => ((persona.seat ?? 1) > 1 ? `-s${persona.seat}` : '');

/** The persona as `variant`: its own scenario name, and the signup copy's and later seats' addresses moved to a domain of their own. */
function variantOf(persona: Persona, variant: Variant): Persona {
  const tag = `${seatTag(persona)}${variant === 'signup' ? '-signup' : ''}`;
  if (!tag) return persona;
  const domain = domainOf(persona.inbox.owner.email);
  const moved = domain.replace(/\.example$/, `${tag}.example`);
  const rename = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll(`@${domain}`, `@${moved}`));
  return { ...persona, inbox: rename(persona.inbox), workspace: rename(persona.workspace) };
}

/** The scenario name the seed CLI marks a variant's rows with. */
export const scenarioName = (persona: Persona, variant: Variant) =>
  `sugbench-${persona.heldout ? 'h-' : ''}${persona.name}${seatTag(persona)}${variant === 'signup' ? '-signup' : ''}`;

/** The persona and its copy, for logs: `founder`, `founder/s2`. */
export const slotName = (persona: Persona) => `${persona.name}${(persona.seat ?? 1) > 1 ? `/s${persona.seat}` : ''}`;

/** The owner's address in `variant`. */
export const ownerEmail = (persona: Persona, variant: Variant) => variantOf(persona, variant).inbox.owner.email;

/** `text` written about `persona`'s seat, with its addresses as the first seat's: every seat is a copy of the first, under a domain of its own. */
export function asFirstSeat(persona: Persona, variant: Variant, text: string): string {
  const seat = domainOf(ownerEmail(persona, variant));
  const first = domainOf(ownerEmail(seatOf(persona, 1), variant));
  return seat === first ? text : text.replaceAll(seat, first);
}

/**
 * Whether `asFirstSeat` keeps `text` as it was but for the seat's domain:
 * `text` names the first seat's domain in no case, and its own only as it is
 * spelled, so renaming neither merges two domains nor changes how one is
 * written (a case-sensitive check against `ACME-S2.EXAMPLE` fails on the
 * seat's mail, and would pass on the first seat's).
 */
export function renamesExactly(persona: Persona, variant: Variant, text: string): boolean {
  const seat = domainOf(ownerEmail(persona, variant));
  const first = domainOf(ownerEmail(seatOf(persona, 1), variant));
  if (seat === first) return true;
  const lower = text.toLowerCase();
  return !lower.includes(first.toLowerCase()) && lower.split(seat.toLowerCase()).length === text.split(seat).length;
}

/** Minutes before the anchor a message arrived; at least one, as the seed CLI needs. */
const minutesBefore = (message: InboxMessage) => Math.max(1, Math.round((ANCHOR - Date.parse(message.date)) / 60_000));

const key = (index: number) => `m${String(index + 1).padStart(3, '0')}`;

/**
 * The seed key of a document or task for text moved `days`. Their text lives
 * in sync-service, which keeps an id's first content for good (a re-apply
 * can't replace it), so text moved another number of days needs ids of its
 * own; an earlier day's items carry the scenario's marker, so the apply
 * removes them.
 */
export const contentKey = (key: string, days: number) => `${key}-day${days}`;

/** The persona's key of a seed key `contentKey` made. */
export const plainKey = (key: string) => key.replace(/-day-?\d+$/, '');

/** Kinds whose text lives in sync-service, so their keys follow the day (`contentKey`). */
export const CONTENT_KINDS = ['documents', 'tasks'] as const;

/** `workspace` with each document and task under its key for `days`, and every `document:` reference to one moved with it. */
function contentKeys<T extends Record<string, unknown>>(workspace: T, days: number): T {
  const renamed = JSON.parse(JSON.stringify(workspace), (_, value) =>
    typeof value === 'string' && value.startsWith('document:') ? `document:${contentKey(value.slice('document:'.length), days)}` : value,
  );
  for (const kind of CONTENT_KINDS) {
    const items = renamed[kind] as Record<string, unknown> | undefined;
    if (items) renamed[kind] = Object.fromEntries(Object.entries(items).map(([key, item]) => [contentKey(key, days), item]));
  }
  return renamed;
}

/**
 * The seed scenario for `variant` at `now`: every date in its text moved to
 * now (clock.ts) and each message a thread of its own, as old as it was at
 * the anchor. The signup copy keeps only the owner and their mail.
 */
export function scenario(persona: Persona, variant: Variant, now: number): Record<string, unknown> {
  const copy = variantOf(persona, variant);
  const days = shiftDays(now);
  const workspace = contentKeys(shiftAll(copy.workspace, days), days);
  const inbox = shiftAll(copy.inbox, days);
  const ownerKey = Object.entries(workspace.users).find(([, user]) => user.email === inbox.owner.email)?.[0];
  if (!ownerKey) throw new Error(`${persona.name}: no user with the inbox owner's address`);
  const threads = Object.fromEntries(
    inbox.messages.map((message, index) => {
      const head = [
        `From: ${message.from.name} <${message.from.email}>`,
        `To: ${message.to.join(', ')}`,
        ...(message.cc.length ? [`Cc: ${message.cc.join(', ')}`] : []),
      ].join('\n');
      return [
        key(index),
        {
          subject: message.subject,
          from: message.from.email,
          body: `${head}\n\n${message.snippet}`,
          unread: message.labels.includes('UNREAD'),
          sent_minutes_ago: minutesBefore(persona.inbox.messages[index]),
        },
      ];
    }),
  );
  const emails = { inbox: { owner: ownerKey, address: inbox.owner.email, threads } };
  const name = scenarioName(persona, variant);
  if (variant === 'signup') {
    return {
      scenario: name,
      description: `${persona.name}, a minute after signing up: the mailbox and nothing else.`,
      users: { [ownerKey]: workspace.users[ownerKey] },
      emails,
    };
  }
  return { ...workspace, scenario: name, emails };
}

/**
 * What email_service's `/internal/recent_messages/{user}` answers for the
 * owner at `now`, newest first: the routines brief reads the mailbox from
 * the provider, which the seed CLI never fills, so the bench's stand-in
 * serves this instead.
 */
export function recentMessages(persona: Persona, variant: Variant, now: number) {
  const copy = variantOf(persona, variant);
  const inbox = shiftAll(copy.inbox, shiftDays(now));
  const messages = inbox.messages
    .map((message, index) => ({
      inbox: inbox.owner.email,
      from: { email: message.from.email, name: message.from.name },
      to: message.to,
      cc: message.cc,
      subject: message.subject.slice(0, 200),
      snippet: message.snippet.slice(0, 500),
      received_at: new Date(now - minutesBefore(persona.inbox.messages[index]) * 60_000).toISOString(),
      labels: message.labels,
    }))
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
  return { messages };
}

/** The persona's answer keys with their dates moved to now, as the judge reads them. */
export function truthAt<T>(truth: T, now: number): T {
  return shiftAll(truth, shiftDays(now));
}
