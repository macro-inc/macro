import { z } from 'zod';

/**
 * Atlassian Statuspage webhook payloads.
 *
 * Shape verified against the official docs:
 * https://support.atlassian.com/statuspage/docs/enable-webhook-notifications/
 *
 * status.claude.com (formerly status.anthropic.com) is powered by Atlassian
 * Statuspage. Two payload kinds exist: incident updates and component updates.
 * Schemas are "loose" because Statuspage may add fields over time.
 */

const pageSchema = z.looseObject({
  id: z.string(),
  status_indicator: z.string(),
  status_description: z.string(),
});

const metaSchema = z.looseObject({
  unsubscribe: z.string().optional(),
  documentation: z.string().optional(),
});

const incidentUpdateSchema = z.looseObject({
  id: z.string(),
  body: z.string(),
  status: z.string(),
  created_at: z.string(),
  display_at: z.string().optional(),
  incident_id: z.string().optional(),
});

const incidentWebhookSchema = z.looseObject({
  meta: metaSchema.optional(),
  page: pageSchema,
  incident: z.looseObject({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    impact: z.string().nullable(),
    shortlink: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    resolved_at: z.string().nullable().optional(),
    incident_updates: z.array(incidentUpdateSchema),
  }),
});

const componentWebhookSchema = z.looseObject({
  meta: metaSchema.optional(),
  page: pageSchema,
  component_update: z.looseObject({
    id: z.string(),
    component_id: z.string(),
    old_status: z.string(),
    new_status: z.string(),
    created_at: z.string(),
  }),
  component: z.looseObject({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    created_at: z.string().optional(),
  }),
});

export type IncidentWebhook = z.infer<typeof incidentWebhookSchema>;
export type ComponentWebhook = z.infer<typeof componentWebhookSchema>;

export type ParsedWebhook =
  | { ok: true; kind: 'incident'; payload: IncidentWebhook }
  | { ok: true; kind: 'component'; payload: ComponentWebhook }
  | { ok: false };

/**
 * Parse a raw webhook body into a known Statuspage payload kind.
 * Returns { ok: false } for anything unrecognized so the caller can
 * acknowledge (2xx) and ignore it.
 */
export function parseWebhookPayload(body: unknown): ParsedWebhook {
  if (typeof body !== 'object' || body === null) {
    return { ok: false };
  }
  const record = body as Record<string, unknown>;

  if (record.incident && typeof record.incident === 'object') {
    const result = incidentWebhookSchema.safeParse(body);
    return result.success
      ? { ok: true, kind: 'incident', payload: result.data }
      : { ok: false };
  }

  if (record.component_update && typeof record.component_update === 'object') {
    const result = componentWebhookSchema.safeParse(body);
    return result.success
      ? { ok: true, kind: 'component', payload: result.data }
      : { ok: false };
  }

  return { ok: false };
}
