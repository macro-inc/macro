import { zValidator } from '@hono/zod-validator';
import {
  DocxAgentError,
  MAX_DOCX_OPERATIONS,
  runDocxAgentRequest,
} from '@macro-inc/collaboration/docx/agent';
import { Hono } from 'hono';
import * as z from 'zod';
import { type Bindings, getEnv } from '../env';
import { createWorkerSyncSource } from '../sources';

/** An optional field that callers may also send as null. */
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

const Id = z.string().min(1);
const Occurrence = optional(z.number().int().positive());
const Flag = optional(z.boolean());

const Operation = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('replaceText'),
    paragraph: Id,
    find: z.string().min(1),
    replace: z.string(),
    occurrence: Occurrence,
  }),
  z.object({ type: z.literal('setText'), paragraph: Id, text: z.string() }),
  z.object({
    type: z.literal('formatText'),
    paragraph: Id,
    find: optional(z.string().min(1)),
    occurrence: Occurrence,
    bold: Flag,
    italic: Flag,
    underline: Flag,
    strikethrough: Flag,
  }),
  z.object({
    type: z.literal('insertParagraph'),
    after: optional(Id),
    before: optional(Id),
    text: z.string(),
    style: optional(z.string().min(1)),
  }),
  z.object({ type: z.literal('delete'), id: Id }),
  z.object({
    type: z.literal('setStyle'),
    paragraph: Id,
    style: z.string().min(1),
  }),
  z.object({
    type: z.literal('addComment'),
    paragraph: Id,
    find: optional(z.string().min(1)),
    occurrence: Occurrence,
    text: z.string().min(1),
  }),
]);

const DocxBody = z.object({
  documentId: z.string().min(1),
  documentToken: z.string().min(1),
  request: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('read'),
      start: optional(z.number().int().positive()),
      count: optional(z.number().int().positive()),
    }),
    z.object({
      action: z.literal('edit'),
      operations: z.array(Operation).min(1).max(MAX_DOCX_OPERATIONS),
      trackChanges: Flag,
      author: optional(z.string().trim().min(1).max(200)),
    }),
  ]),
});

/** Access levels whose tokens may edit a document's content. */
const EDIT_ACCESS = new Set(['edit', 'owner']);

/**
 * The access level a document token claims. The sync service verifies the
 * token's signature on connect; this only reads the claim.
 */
function tokenAccessLevel(token: string): string | undefined {
  try {
    const payload = token.split('.')[1] ?? '';
    const claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    ) as { access_level?: unknown };
    return typeof claims.access_level === 'string'
      ? claims.access_level
      : undefined;
  } catch {
    return undefined;
  }
}

const docx = new Hono<{ Bindings: Bindings }>();

/**
 * Read or edit an uploaded Word document's live collaborative copy. Auth is
 * the document permission token, which the sync service checks on connect.
 * The socket also accepts comment-level writes, so edits additionally
 * require a token that grants edit access.
 */
docx.post('/', zValidator('json', DocxBody), async (c) => {
  const env = getEnv(c.env);
  const { documentId, documentToken, request } = c.req.valid('json');
  if (
    request.action === 'edit' &&
    !EDIT_ACCESS.has(tokenAccessLevel(documentToken) ?? '')
  )
    return c.json(
      { error: 'Editing this Word document requires edit access.' },
      403
    );
  const wsUrl = `${env.SYNC_WS_BASE}/document/${documentId}/connect?token=${documentToken}`;
  const source = createWorkerSyncSource(wsUrl, documentId, c.req.raw.signal);
  try {
    return c.json(await runDocxAgentRequest(source, request));
  } catch (error) {
    if (error instanceof DocxAgentError)
      return c.json({ error: error.message }, 422);
    console.error('docx request failed:', documentId, error);
    return c.json(
      {
        error:
          'The Word document could not be reached. Read it again before retrying an edit.',
      },
      500
    );
  } finally {
    source.cleanup();
  }
});

export default docx;
