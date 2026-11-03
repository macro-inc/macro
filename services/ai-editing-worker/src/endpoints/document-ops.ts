import { zValidator } from '@hono/zod-validator';
import type { DocumentOp } from '@macro-inc/editor-ops/document';
import { Telemetry } from '@macro-inc/observability';
import { Hono } from 'hono';
import * as z from 'zod';
import { runDocumentOps, UnacknowledgedError } from '../document-ops/run';
import { tokenAccessLevel } from '../document-token';
import { type Bindings, getEnv } from '../env';
import { createWorkerSyncSource } from '../sources';

const EDIT_ACCESS = new Set(['edit', 'owner']);

const DocumentOpsBody = z.object({
  documentId: z.string().min(1),
  documentToken: z.string().min(1),
  // Each op is checked by applying the batch to a scratch copy first.
  operations: z
    .array(z.looseObject({ kind: z.string() }))
    .min(1)
    .max(200),
  /** Names the cursor and AI peer the edit is attributed to. */
  editor: z.object({ name: z.string().trim().min(1) }).optional(),
});

const documentOps = new Hono<{ Bindings: Bindings }>();

/**
 * Apply `DocumentEditor` ops to a markdown document without a model. The batch
 * is all-or-nothing: if any op fails against the current document, nothing is
 * committed and every failing op is reported with a 422.
 */
documentOps.post('/', zValidator('json', DocumentOpsBody), async (c) => {
  const env = getEnv(c.env);
  const { documentId, documentToken, operations, editor } = c.req.valid('json');
  // A forged edit claim still fails signature verification on initial sync.
  if (!EDIT_ACCESS.has(tokenAccessLevel(documentToken) ?? ''))
    return c.json(
      { error: 'Editing this document requires edit access.' },
      403
    );
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(30_000),
  ]);
  try {
    const wsUrl = `${env.SYNC_WS_BASE}/document/${documentId}/connect?token=${documentToken}`;
    const result = await Telemetry.span('edit.document_ops', async (span) => {
      span.setAttr('document.id', documentId);
      span.setAttr('edit.ops_total', operations.length);
      span.setAttr('edit.editor_named', editor !== undefined);
      try {
        const result = await runDocumentOps(
          createWorkerSyncSource(wsUrl, documentId, signal),
          documentId,
          operations as DocumentOp[],
          editor
        );
        if ('failures' in result) {
          span.setAttr('edit.ops_applied', 0);
          span.setAttr('edit.ops_failed', result.failures.length);
        } else {
          span.setAttr('edit.ops_applied', result.applied);
          span.setAttr('edit.ops_failed', 0);
        }
        return result;
      } catch (err) {
        span.setAttr('edit.unacknowledged', err instanceof UnacknowledgedError);
        span.error(err);
        throw err;
      }
    });
    if ('failures' in result)
      return c.json({ error: 'edit_rejected', failures: result.failures }, 422);
    return c.json({
      applied: result.applied,
      changedBlockIds: result.changedBlockIds,
      revision: result.revision,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UnacknowledgedError)
      return c.json({ error: 'unacknowledged', message }, 502);
    console.error('document ops failed:', message);
    return c.json({ error: message }, signal.aborted ? 504 : 502);
  }
});

export default documentOps;
