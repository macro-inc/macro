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
export type RoutinesTruth = { needs: RoutineNeed[]; decoys: RoutineDecoy[] };

export type Persona = {
  name: string;
  heldout: boolean;
  dir: string;
  workspace: Record<string, unknown> & { scenario: string; description: string; users: Record<string, { email: string }> };
  inbox: Inbox;
  feedTruth?: FeedTruth;
  routinesTruth?: RoutinesTruth;
};

const readJson = <T>(path: string): T | undefined =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;

function load(dir: string, name: string, heldout: boolean): Persona {
  const workspace = readJson<Persona['workspace']>(join(dir, 'workspace.json'));
  const inbox = readJson<Inbox>(join(dir, 'inbox.json'));
  if (!workspace || !inbox) throw new Error(`${dir} lacks workspace.json or inbox.json`);
  return {
    name,
    heldout,
    dir,
    workspace,
    inbox,
    feedTruth: readJson(join(dir, 'feed-truth.json')),
    routinesTruth: readJson(join(dir, 'routines-truth.json')),
  };
}

const folders = (root: string) =>
  existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];

/** The tune personas, or the held-out set `set` (a folder under the held-out directory). */
export function personas(set: 'tune' | string): Persona[] {
  if (set === 'tune') return folders(TUNE_DIR).map((name) => load(join(TUNE_DIR, name), name, false));
  const root = join(HELDOUT_DIR, set);
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

/** The persona as `variant`: its own scenario name, and the signup copy's addresses moved to their own domain. */
function variantOf(persona: Persona, variant: Variant): Persona {
  if (variant === 'full') return persona;
  const domain = domainOf(persona.inbox.owner.email);
  const signupDomain = domain.replace(/\.example$/, '-signup.example');
  const rename = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll(`@${domain}`, `@${signupDomain}`));
  return { ...persona, inbox: rename(persona.inbox), workspace: rename(persona.workspace) };
}

/** The scenario name the seed CLI marks a variant's rows with. */
export const scenarioName = (persona: Persona, variant: Variant) =>
  `sugbench-${persona.heldout ? 'h-' : ''}${persona.name}${variant === 'signup' ? '-signup' : ''}`;

/** The owner's address in `variant`. */
export const ownerEmail = (persona: Persona, variant: Variant) => variantOf(persona, variant).inbox.owner.email;

/** Minutes before the anchor a message arrived; at least one, as the seed CLI needs. */
const minutesBefore = (message: InboxMessage) => Math.max(1, Math.round((ANCHOR - Date.parse(message.date)) / 60_000));

const key = (index: number) => `m${String(index + 1).padStart(3, '0')}`;

/**
 * The seed scenario for `variant` at `now`: every date in its text moved to
 * now (clock.ts) and each message a thread of its own, as old as it was at
 * the anchor. The signup copy keeps only the owner and their mail.
 */
export function scenario(persona: Persona, variant: Variant, now: number): Record<string, unknown> {
  const copy = variantOf(persona, variant);
  const days = shiftDays(now);
  const workspace = shiftAll(copy.workspace, days);
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
