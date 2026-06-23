import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
} from '@notifications/notification-metadata';
import type { UnifiedNotification } from '@notifications/types';
import { z } from 'zod';
import { createAIObject } from './createAIObject';

/**
 * Experiment: triage the user's recent notifications with a fast model via the
 * existing DCS structured-output proxy (`createAIObject` -> `/chat/completions`
 * with a strict `json_schema`). Focus is on surfacing the most important emails.
 */

// The proxy is OpenAI-compatible; gpt-4o-mini is the fast model already used
// elsewhere in the app (see `generateTitle`). Swap this one string to retarget.
const FAST_MODEL = 'gpt-4o-mini';

export const triageActions = [
  'reply_now',
  'reply_later',
  'delegate',
  'archive',
] as const;
export type TriageAction = (typeof triageActions)[number];

/** Surface at most this many emails — keep the list short and high-signal. */
export const MAX_TRIAGE_EMAILS = 3;

export const triageSchema = z
  .object({
    emails: z
      .array(
        z.object({
          sender: z.string().describe('Sender display name'),
          subject: z.string().describe('Email subject line'),
          action: z
            .enum(triageActions)
            .describe('Single recommended action for this email'),
          reason: z
            .string()
            .describe('Why it matters, max ~8 words, no trailing period'),
          prompt: z
            .string()
            .describe(
              'A concrete, specific instruction the founder can run in their AI composer to handle this email right now — e.g. "Draft a reply to Renuka at Sprinto asking for SOC 2 pricing and a 30-day audit-ready timeline." Written as a direct command, specific to the actual email, never generic.'
            ),
        })
      )
      .describe(`The ${MAX_TRIAGE_EMAILS} most important emails, ranked`),
  })
  .describe('notification triage');

export type NotificationTriage = z.infer<typeof triageSchema>;
export type TriagedEmail = NotificationTriage['emails'][number];

const SYSTEM_PROMPT = [
  "You are an executive assistant triaging a startup founder's emails.",
  `Return AT MOST ${MAX_TRIAGE_EMAILS} emails — only the ones genuinely worth acting on now, ranked most important first.`,
  'Skip cold sales outreach, recruiting spam, and newsletters entirely — do not include them, UNLESS one maps to a real business need (e.g. SOC 2 / security / compliance to close enterprise deals).',
  'For each email set: action (reply_now, reply_later, or delegate), a terse reason, and a concrete `prompt` instruction the founder can run to handle it.',
  'The prompt must be specific to the actual email content (names, asks, context), not a generic template.',
].join(' ');

function describeNotification(n: UnifiedNotification, index: number): string {
  const meta = n.notification_metadata;
  const position = index + 1;

  if (meta.tag === 'new_email') {
    const sender = meta.content.sender ?? 'unknown sender';
    const status = n.viewed_at ? 'read' : 'unread';
    return `${position}. [EMAIL] from ${sender} (${status}) — subject: "${meta.content.subject}" — ${meta.content.snippet}`;
  }

  const action = getNotificationAction(n);
  const target = getNotificationTargetName(n);
  const content = getNotificationContent(n)
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const who = n.sender_id ?? 'someone';

  return [
    `${position}. [${n.entity_type}] ${who} ${action}`,
    target ? ` ${target}` : '',
    content ? `: ${content}` : '',
  ].join('');
}

/** Pure: render notifications into the prompt body the model receives. */
export function buildTriagePrompt(
  notifications: readonly UnifiedNotification[]
): string {
  const lines = notifications.map(describeNotification).join('\n');
  return `Here are my last ${notifications.length} notifications (newest first):\n\n${lines}`;
}

/**
 * TanStack mutation that triages a batch of notifications. Call `.mutate(notifs)`
 * with the notifications to analyze; `.data` holds the validated {@link NotificationTriage}.
 */
export function createNotificationTriage() {
  return createAIObject<typeof triageSchema, readonly UnifiedNotification[]>({
    schema: triageSchema,
    schemaName: 'notification_triage',
    model: FAST_MODEL,
    system: SYSTEM_PROMPT,
    prompt: buildTriagePrompt,
    temperature: 0.2,
    maxTokens: 700,
  });
}
