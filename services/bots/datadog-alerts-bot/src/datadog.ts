import { z } from 'zod';

/**
 * Datadog webhook notification payloads.
 *
 * Datadog webhooks send a user-defined JSON template; this schema matches
 * the template configured on the `macro-ai-alert-bot` webhook integration
 * (Integrations → Webhooks):
 *
 * ```json
 * {
 *   "title": "$EVENT_TITLE",
 *   "body": "$EVENT_MSG",
 *   "transition": "$ALERT_TRANSITION",
 *   "link": "$LINK",
 *   "priority": "$PRIORITY",
 *   "tags": "$TAGS",
 *   "date": "$DATE"
 * }
 * ```
 *
 * The schema is "loose" so extra fields added to the template later don't
 * break parsing. Only `title` and `transition` are required — they always
 * render for monitor notifications.
 */
const datadogWebhookSchema = z.looseObject({
  title: z.string(),
  transition: z.string(),
  body: z.string().optional(),
  link: z.string().optional(),
  priority: z.string().optional(),
  tags: z.string().optional(),
  date: z.string().optional(),
});

export type DatadogWebhook = z.infer<typeof datadogWebhookSchema>;

export type ParsedWebhook =
  | { ok: true; payload: DatadogWebhook }
  | { ok: false };

/**
 * Parse a raw webhook body into a Datadog alert payload.
 * Returns { ok: false } for anything unrecognized so the caller can
 * acknowledge (2xx) and ignore it.
 */
export function parseWebhookPayload(body: unknown): ParsedWebhook {
  if (typeof body !== 'object' || body === null) {
    return { ok: false };
  }

  const result = datadogWebhookSchema.safeParse(body);
  return result.success ? { ok: true, payload: result.data } : { ok: false };
}
