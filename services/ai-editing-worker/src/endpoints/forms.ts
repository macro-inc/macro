import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { MAX_FORM_DOCUMENT_BYTES, prepareFormEdit } from '../forms/runtime';

const question = z
  .object({
    id: z.string().uuid(),
    column: z.string().uuid(),
    helpText: z.string(),
    required: z.boolean(),
    widget: z.string().nullable(),
  })
  .transform((question) => ({ ...question, widget: question.widget ?? null }));
// This is a codec boundary, not a second Forms policy validator. Additional
// section fields round-trip through the shared codec; Forms validates semantics.
const body = z.object({
  snapshot: z.string().max(Math.ceil(MAX_FORM_DOCUMENT_BYTES / 3) * 4),
  layout: z.object({
    sections: z.array(
      z.looseObject({
        id: z.string().uuid(),
        kind: z.enum(['questions', 'gate', 'booking']),
        questions: z.array(question).optional(),
      })
    ),
  }),
});
const app = new Hono();
app.use('*', bodyLimit({ maxSize: 8 * 1024 * 1024 }));

/** Stateless transform: no credential, entity lookup, model call or persistence.
 * Only the authorized Forms service can apply the returned delta to a form. */
app.post('/', zValidator('json', body), (c) => {
  const { snapshot, layout } = c.req.valid('json');
  try {
    const bytes = Uint8Array.from(atob(snapshot), (char) => char.charCodeAt(0));
    const update = prepareFormEdit(bytes, layout);
    return new Response(Uint8Array.from(update).buffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  } catch {
    return c.json(
      { error: 'The form snapshot or layout could not be edited.' },
      422
    );
  }
});
export default app;
