import { addDays, differenceInCalendarDays } from 'date-fns';
import { z } from 'zod';

export const stepSchema = z.object({
  id: z.string(),
  delayDays: z.number().int().min(0).max(365),
  subject: z.string().max(300),
  body: z.string().max(50_000),
});
export const campaignSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500),
  status: z.enum(['draft', 'active', 'paused', 'archived']),
  senderId: z.string(),
  steps: z.array(stepSchema).max(20),
  updatedAt: z.string(),
});
export const contactSchema = z.object({
  email: z.email(),
  name: z.string(),
  crmContactId: z.string().optional(),
  companyId: z.string().optional(),
});
export const queuedStepSchema = stepSchema.extend({
  sendAt: z.string(),
  draftId: z.string().optional(),
  /** The draft's server edit generation; cancel and delete must echo it. */
  draftGeneration: z.number().int().min(0).optional(),
  /** The draft's thread, used to read its delivery state. */
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
  error: z.string().optional(),
});

export type Campaign = z.infer<typeof campaignSchema>;
export type SequenceStep = z.infer<typeof stepSchema>;
export type MarketingContact = z.infer<typeof contactSchema>;
export type Enrollment = z.infer<typeof enrollmentSchema>;
export type QueuedStep = z.infer<typeof queuedStepSchema>;
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
/** Why an enrollment needs a look, beyond its stored status. */
export type AttentionReason = DeliveryIssue | 'disconnected';
export type MarketingSnapshot = {
  campaigns: Campaign[];
  enrollments: Enrollment[];
  databaseId?: string;
  writable: boolean;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function personalize(text: string, contact: MarketingContact) {
  const variables: Record<string, string> = {
    firstName: contact.name.trim().split(/\s+/)[0] || 'there',
    name: contact.name || 'there',
    email: contact.email,
  };
  return text.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (token, name) => variables[name] ?? token
  );
}

/**
 * Enrollments freeze every personalized step into one database cell, and a
 * write must stay under the 2 MiB request limit after two rounds of JSON
 * escaping. 100k characters leaves room for multi-byte text and escaping.
 */
export const MAX_SEQUENCE_CHARACTERS = 100_000;

export function validateCampaign(campaign: Campaign) {
  if (!campaign.name.trim()) throw new Error('Give your campaign a name.');
  if (!campaign.senderId) throw new Error('Choose a connected Gmail inbox.');
  if (!campaign.steps.length) throw new Error('Add at least one email.');
  for (const step of campaign.steps) {
    if (/[\r\n]/.test(step.subject))
      throw new Error('Subjects must be a single line.');
    if (!step.subject.trim() || !step.body.trim())
      throw new Error('Every email needs a subject and a message.');
    if (
      !Number.isInteger(step.delayDays) ||
      step.delayDays < 0 ||
      step.delayDays > 365
    )
      throw new Error('Delays must be whole days between 0 and 365.');
    const unknown = `${step.subject}\n${step.body}`
      .match(/\{\{\s*(\w+)\s*\}\}/g)
      ?.filter(
        (token) => !/^\{\{\s*(firstName|name|email)\s*\}\}$/.test(token)
      );
    if (unknown?.length)
      throw new Error(`Unknown personalization: ${unknown.join(', ')}`);
  }
  const characters = campaign.steps.reduce(
    (total, step) => total + step.subject.length + step.body.length,
    0
  );
  if (characters > MAX_SEQUENCE_CHARACTERS)
    throw new Error(
      `This sequence is too long to send. Keep all emails under ${MAX_SEQUENCE_CHARACTERS.toLocaleString('en-US')} characters combined.`
    );
}

// A safety window leaves time to persist draft handles and roll back a failed enrollment.
export const MIN_START_DELAY_MS = 10 * 60_000;
export function planSteps(
  campaign: Campaign,
  contact: MarketingContact,
  startAt: Date
) {
  if (!Number.isFinite(startAt.getTime()))
    throw new Error('Choose a valid start time.');
  // Calendar days keep the local send time across daylight-saving changes.
  let time = startAt;
  return campaign.steps.map((step) => {
    time = addDays(time, step.delayDays);
    return {
      ...step,
      subject: personalize(step.subject, contact),
      body: `${personalize(step.body, contact)}\n\nIf you would prefer not to receive these emails, reply unsubscribe.`,
      sendAt: time.toISOString(),
      status: 'pending' as const,
    };
  });
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
      name: contact.name || previous?.name || '',
      crmContactId: contact.crmContactId ?? previous?.crmContactId,
      companyId: contact.companyId ?? previous?.companyId,
    });
  }
  return [...result.values()].sort((a, b) =>
    (a.name || a.email).localeCompare(b.name || b.email)
  );
}
