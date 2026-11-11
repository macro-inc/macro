/**
 * The mail area's settings: every name, place and limit it uses, so no other
 * file in it holds a path, an address or a number of its own.
 */

/** The owner of mail's state directories. */
export const owner = 'mail';

/**
 * The credentials of the OAuth client that reads the agent's Gmail account
 * and sends the one kind of reply. Mail is optional: without all three, the
 * whole area stays idle.
 */
export const mailCredentials = {
  clientId: 'MAIL_CLIENT_ID',
  clientSecret: 'MAIL_CLIENT_SECRET',
  refreshToken: 'MAIL_REFRESH_TOKEN',
} as const;

/** What a mail function says when the mailbox isn't set up. */
export const notSetUp = `Mail isn't set up: add ${Object.values(mailCredentials).join(', ')} with setCredential.`;

export const gmail = {
  api: 'https://gmail.googleapis.com/gmail/v1/users/me',
  token: 'https://oauth2.googleapis.com/token',
  /** How long one request may take. */
  timeoutMs: 30_000,
} as const;

/** Files in mail's own state directories. */
export const files = {
  /** private: the watcher's position, and what is pending, being acted on, and done. */
  watch: 'state.json',
  /** private: what mail has done, read back by age for the limits. */
  events: 'events.jsonl',
  /** private: sign-ins a run said it was about to make. */
  expected: 'expected.jsonl',
  /** private: a redacted copy of each mail, one file per id. */
  messages: 'messages',
  /** run: mail the review said was wrongly dropped, waiting for the watcher to pick it up. */
  missed: 'missed.jsonl',
  /** run: held while a reply is gated and sent. */
  replyLock: 'reply.lock',
  /** memory: the misses the review recorded, as test cases. Facts and the reviewer's words only. */
  examples: 'examples.jsonl',
} as const;

/** Mail's logs, in its log directory. */
export const streams = {
  /** Every decision and what came of it. */
  mail: 'mail',
  /** What the filter dropped: sender, redacted subject, scores. Never a body. */
  filtered: 'filtered',
  /** Every review of the filter, and every change to it. */
  reviews: 'reviews',
} as const;

/** Files in the shared memory that mail reads or adds to. */
export const shared = {
  notes: 'notes.md',
  asks: 'asks.md',
} as const;

/** The filter the agent tunes, from this repository's root. */
export const filterFile = [
  'behavior',
  'capabilities',
  'mail',
  'filter.ts',
] as const;

/** How often the mailbox is checked, and the longest wait after failures. */
export const pollMs = 60_000;
export const longestBackoffMs = 5 * 60_000;
/** How often an idle watcher looks again for the mail credentials. */
export const idleCheckMs = 10 * 60_000;
/** How long the mailbox may be unreachable before the owner hears. */
export const troubleAfterMinutes = 15;
/** How many times a mail may fail to be read or triaged before it goes to the notes. */
export const maxAttempts = 8;
/** How long a handled mail is remembered, so replayed history can't act twice. */
export const rememberDoneDays = 30;
/** How far back a resync looks when Gmail has forgotten the position. */
export const resyncQuery = 'newer_than:14d';

/** The schedule that wakes the agent to look at what the filter dropped. */
export const reviewSchedule = 'mail-filter-review';
export const reviewHours = 24;

/** The source that carries new mail to the handler. */
export const mailSource = 'mail';
