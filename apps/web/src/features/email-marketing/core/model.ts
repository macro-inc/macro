import { getFirstName } from '@app/features/email-message/core/name';
import { addDays, differenceInCalendarDays } from 'date-fns';
import { match } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import {
  ENROLLMENT_ERRORS,
  type EnrollmentErrorCode,
  MarketingError,
} from './errors';

const stepSchema = z.object({
  id: z.string(),
  delayDays: z.number().int().min(0).max(365),
  subject: z.string().max(300),
  body: z.string().max(50_000),
  /** A follow-up sent as a reply in the previous email's thread. */
  asReply: z.boolean().optional(),
});
export const campaignSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500),
  status: z.enum(['draft', 'active', 'paused']),
  senderId: z.string(),
  steps: z.array(stepSchema).max(20),
  /** Appended to every email. Older records use the default line. */
  optOutLine: z.string().max(300).optional(),
  updatedAt: z.string(),
});
export const contactSchema = z.object({
  email: z.email(),
  name: z.string(),
  crmContactId: z.string().optional(),
  companyId: z.string().optional(),
});
/** A frozen step: personalization can lengthen it past the template limits. */
const queuedStepSchema = stepSchema.extend({
  subject: z.string().max(1_000),
  body: z.string().max(120_000),
  sendAt: z.string(),
  draftId: z.string().optional(),
  /** The draft's server edit generation; cancel and delete must echo it. */
  draftGeneration: z.number().int().min(0).optional(),
  /** The draft's thread, used to read its delivery state and to open it. */
  threadId: z.string().optional(),
  status: z.enum([
    'pending',
    'scheduling',
    'queued',
    'canceled',
    'delivery_started',
  ]),
});
export const enrollmentSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  campaignName: z.string(),
  contact: contactSchema,
  senderId: z.string(),
  status: z.enum([
    'preparing',
    'scheduled',
    'paused',
    'stopped',
    'needs_attention',
  ]),
  steps: z.array(queuedStepSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** An enrollment error code; records from before codes may hold text. */
  error: z.string().optional(),
});
/** An address that every campaign must skip. */
export const unsubscribeSchema = z.object({
  email: z.email(),
  unsubscribedAt: z.string(),
});

export type Campaign = z.infer<typeof campaignSchema>;
export type SequenceStep = z.infer<typeof stepSchema>;
export type MarketingContact = z.infer<typeof contactSchema>;
export type Enrollment = z.infer<typeof enrollmentSchema>;
export type QueuedStep = z.infer<typeof queuedStepSchema>;
export type Unsubscribe = z.infer<typeof unsubscribeSchema>;
export type Sender = { id: string; email: string; ready: boolean };
/**
 * An inbox as the signed-in user sees it. `disconnected` means the id is not
 * one of their inboxes: disconnecting deletes the link and its scheduled
 * emails, and reconnecting creates a new id.
 */
export type SenderStatus = 'ready' | 'reauth' | 'disconnected';
/**
 * Delivery problems read back from the scheduler. Display-only: they are not
 * persisted, because the scheduler (not the database row) is the source of truth.
 * - `stalled`: still scheduled well after its send time.
 * - `failed`: Gmail rejected it (for example a rate or daily limit); it will not retry.
 * - `unconfirmed`: Gmail may or may not have sent it.
 * - `missing`: no longer scheduled, but it was never sent by this sequence
 *   (for example deleted or sent from Drafts).
 */
export type DeliveryIssue = 'stalled' | 'failed' | 'unconfirmed' | 'missing';
/**
 * Why an enrollment needs a look, beyond its stored status. `interrupted`:
 * scheduling stopped partway, for example because the tab closed.
 */
export type AttentionReason = DeliveryIssue | 'disconnected' | 'interrupted';
export type MarketingSnapshot = {
  campaigns: Campaign[];
  enrollments: Enrollment[];
  unsubscribed: Unsubscribe[];
  /** Records that could not be read; enrolling waits until they are fixed. */
  unreadable: number;
  databaseId?: string;
  writable: boolean;
};

export const EMPTY_SNAPSHOT: MarketingSnapshot = {
  campaigns: [],
  enrollments: [],
  unsubscribed: [],
  unreadable: 0,
  writable: true,
};

export const DEFAULT_OPT_OUT_LINE =
  'If you would prefer not to receive these emails, reply "unsubscribe".';

/** An id for a record stored in the user's database. */
export function newId() {
  return uuidv7();
}

/** Cut text to `max` UTF-16 units without splitting a surrogate pair. */
export function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A list search: the query appears in any of the fields, ignoring case. */
export function matchesSearch(query: string, ...fields: string[]) {
  return fields.join(' ').toLowerCase().includes(query.toLowerCase());
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isUnsubscribed(snapshot: MarketingSnapshot, email: string) {
  const address = normalizeEmail(email);
  return snapshot.unsubscribed.some(
    (entry) => normalizeEmail(entry.email) === address
  );
}

/** No step of the enrollment was ever handed to Gmail or is still queued. */
export function nothingDelivered(entry: Enrollment) {
  return entry.steps.every(
    (step) => step.status === 'pending' || step.status === 'canceled'
  );
}

/**
 * A failed enrollment with nothing queued or delivered can be replaced by a
 * fresh one. Paused and stopped enrollments still block, by design: a bulk
 * enroll must not undo a deliberate pause or stop.
 */
export function isReplaceable(entry: Enrollment) {
  return entry.status === 'needs_attention' && nothingDelivered(entry);
}

export function isEnrollmentErrorCode(
  error: string | undefined
): error is EnrollmentErrorCode {
  return ENROLLMENT_ERRORS.some((code) => code === error);
}

/** Enrollments that are sending or may still send: what a pause acts on. */
export const LIVE_STATUSES: readonly Enrollment['status'][] = [
  'preparing',
  'scheduled',
  'needs_attention',
];

/** A step the scheduler holds, or has already handed to Gmail. */
export function isOnScheduler(step: QueuedStep) {
  return (
    !!step.draftId &&
    (step.status === 'queued' ||
      step.status === 'scheduling' ||
      step.status === 'delivery_started')
  );
}

export function isCampaignActive(snapshot: MarketingSnapshot, id: string) {
  return snapshot.campaigns.find((item) => item.id === id)?.status === 'active';
}

/** Why an inbox can't send right now; `undefined` while inboxes load means unknown. */
export function senderError(status: SenderStatus | undefined) {
  return match(status)
    .with('ready', () => undefined)
    .with('disconnected', () => new MarketingError('inboxDisconnected'))
    .with('reauth', () => new MarketingError('inboxReauth'))
    .with(undefined, () => new MarketingError('inboxesLoading'))
    .exhaustive();
}

const TOKEN = /\{\{\s*(\w+)\s*\}\}/g;
const KNOWN_TOKEN = /^\{\{\s*(firstName|name|email)\s*\}\}$/;
/** Tokens a contact can't fill in, including malformed `{{`/`}}` pairs. */
function unknownTokens(text: string) {
  const unknown = (text.match(TOKEN) ?? []).filter(
    (token) => !KNOWN_TOKEN.test(token)
  );
  // Once whole tokens are gone, any `{{` or `}}` left is a typo. Report the
  // text around it; a linear scan keeps long bodies cheap.
  const rest = text.replace(TOKEN, ' ');
  for (const found of rest.matchAll(/\{\{|\}\}/g)) {
    const at = found.index;
    const fragment =
      found[0] === '{{'
        ? rest.slice(at, at + 24).split('\n')[0]
        : rest
            .slice(Math.max(0, at - 22), at + 2)
            .split('\n')
            .at(-1);
    unknown.push(fragment?.trim() ?? found[0]);
  }
  return [...new Set(unknown)];
}

export function personalize(text: string, contact: MarketingContact) {
  const variables: Record<string, string> = {
    firstName: getFirstName(contact.name) || 'there',
    name: contact.name.trim() || 'there',
    email: contact.email,
  };
  return text.replace(TOKEN, (token, name) => variables[name] ?? token);
}

/** Follow-ups after the first email that reply in its thread. */
export function isReplyStep(steps: SequenceStep[], index: number) {
  return index > 0 && steps[index].asReply === true;
}

/** The subject a step is sent with: replies reuse their thread's subject. */
export function threadSubject(steps: SequenceStep[], index: number) {
  let root = index;
  while (isReplyStep(steps, root)) root--;
  return steps[root].subject;
}

export function replySubject(subject: string) {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

/**
 * Enrollments freeze every personalized step into one database cell, and a
 * write must stay under the 2 MiB request limit after two rounds of JSON
 * escaping. 100k characters leaves room for multi-byte text and escaping.
 */
const MAX_SEQUENCE_CHARACTERS = 100_000;

export function validateCampaign(campaign: Campaign) {
  if (!campaign.name.trim()) throw new MarketingError('nameRequired');
  if (!campaign.senderId) throw new MarketingError('senderRequired');
  if (!campaign.steps.length) throw new MarketingError('stepsRequired');
  const optOut = campaign.optOutLine ?? DEFAULT_OPT_OUT_LINE;
  if (!optOut.trim()) throw new MarketingError('optOutRequired');
  const optOutTokens = unknownTokens(optOut);
  if (optOutTokens.length)
    throw new MarketingError('unknownPersonalization', {
      tokens: optOutTokens.join(', '),
    });
  for (const [index, step] of campaign.steps.entries()) {
    const position = index + 1;
    if (!isReplyStep(campaign.steps, index)) {
      if (/[\r\n]/.test(step.subject))
        throw new MarketingError('subjectSingleLine', { position });
      if (!step.subject.trim())
        throw new MarketingError('subjectRequired', { position });
    }
    if (!step.body.trim())
      throw new MarketingError('bodyRequired', { position });
    if (
      !Number.isInteger(step.delayDays) ||
      step.delayDays < 0 ||
      step.delayDays > 365
    )
      throw new MarketingError('delayRange', { position });
    const unknown = unknownTokens(`${step.subject}\n${step.body}`);
    if (unknown.length)
      throw new MarketingError('unknownPersonalization', {
        tokens: unknown.join(', '),
      });
  }
  const characters = campaign.steps.reduce(
    (total, step) => total + step.subject.length + step.body.length,
    0
  );
  if (characters > MAX_SEQUENCE_CHARACTERS)
    throw new MarketingError('sequenceTooLong', {
      max: MAX_SEQUENCE_CHARACTERS,
    });
}

// A safety window leaves time to persist draft handles and roll back a failed enrollment.
export const MIN_START_DELAY_MS = 10 * 60_000;
/** Contacts enrolled per batch; each one schedules every step in order. */
export const MAX_ENROLLMENT_BATCH = 50;

export function planSteps(
  campaign: Campaign,
  contact: MarketingContact,
  startAt: Date
): QueuedStep[] {
  if (!Number.isFinite(startAt.getTime()))
    throw new MarketingError('invalidStartTime');
  const optOut = personalize(
    (campaign.optOutLine ?? DEFAULT_OPT_OUT_LINE).trim(),
    contact
  );
  // Calendar days keep the local send time across daylight-saving changes.
  let time = startAt;
  return campaign.steps.map((step, index) => {
    time = addDays(time, step.delayDays);
    // A name can carry line breaks; a subject must stay one header line.
    const subject = personalize(
      threadSubject(campaign.steps, index),
      contact
    ).replace(/[\r\n]+/g, ' ');
    return {
      id: step.id,
      delayDays: step.delayDays,
      asReply: isReplyStep(campaign.steps, index) || undefined,
      subject: isReplyStep(campaign.steps, index)
        ? replySubject(subject)
        : subject,
      body: `${personalize(step.body, contact)}\n\n${optOut}`,
      sendAt: time.toISOString(),
      status: 'pending' as const,
    };
  });
}

/**
 * The draft a reply step answers: the nearest earlier step in its own thread
 * (back to the email that started it) that was queued or sent. `undefined`
 * starts a new thread, for example when that thread's emails were skipped on
 * resume.
 */
export function replyParent(steps: QueuedStep[], index: number) {
  if (!steps[index]?.asReply) return undefined;
  for (let at = index - 1; at >= 0; at--) {
    const step = steps[at];
    if (
      step.draftId &&
      (step.status === 'queued' || step.status === 'delivery_started')
    )
      return step.draftId;
    if (!step.asReply) return undefined;
  }
  return undefined;
}

/** A reply without a parent goes out as a new email under its own subject. */
export function standaloneSubject(subject: string) {
  return subject.replace(/^re:\s*/i, '');
}

/**
 * Move remaining steps so the first is no earlier than `earliest`, keeping
 * the calendar-day gaps between them. Steps already late enough are unchanged.
 */
export function rescheduleSteps<T extends { sendAt: string }>(
  steps: T[],
  earliest: Date
): T[] {
  const first = steps[0];
  if (!first) return [];
  const original = new Date(first.sendAt);
  if (original.getTime() >= earliest.getTime()) return steps;
  return steps.map((step) => ({
    ...step,
    sendAt: addDays(
      earliest,
      differenceInCalendarDays(new Date(step.sendAt), original)
    ).toISOString(),
  }));
}

export function mergeContacts(contacts: MarketingContact[]) {
  const result = new Map<string, MarketingContact>();
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email);
    if (!contactSchema.safeParse({ ...contact, email }).success) continue;
    const previous = result.get(email);
    result.set(email, {
      ...previous,
      ...contact,
      email,
      name: contact.name.trim() || previous?.name || '',
      crmContactId: contact.crmContactId ?? previous?.crmContactId,
      companyId: contact.companyId ?? previous?.companyId,
    });
  }
  return [...result.values()].sort((a, b) =>
    (a.name || a.email).localeCompare(b.name || b.email)
  );
}
