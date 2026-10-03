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
export type Sender = { id: string; email: string; ready: boolean };
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
}

// A safety window leaves time to persist draft handles and roll back a failed enrollment.
export const MIN_START_DELAY_MS = 10 * 60_000;
export function planSteps(
  campaign: Campaign,
  contact: MarketingContact,
  startAt: Date
) {
  let time = startAt.getTime();
  if (!Number.isFinite(time)) throw new Error('Choose a valid start time.');
  return campaign.steps.map((step) => {
    time += step.delayDays * 86_400_000;
    return {
      ...step,
      subject: personalize(step.subject, contact),
      body: `${personalize(step.body, contact)}\n\nIf you would prefer not to receive these emails, reply unsubscribe.`,
      sendAt: new Date(time).toISOString(),
      status: 'pending' as const,
    };
  });
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
