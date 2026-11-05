import { z } from 'zod';
import { embedDocumentOpSchema } from './schema';
import type { CanvasSession } from './session';

/**
 * The internal embed request: one document node under a caller-chosen item
 * id, and the mention its caller recorded. Repeating it is a no-op, so a
 * caller that lost the response retries with the same ids.
 */
export const canvasEmbedRequest = embedDocumentOpSchema
  .omit({ kind: true, id: true })
  .extend({
    action: z.literal('embed'),
    itemId: z.string().uuid(),
    mentionId: z.string().uuid(),
  })
  .strict();
export type CanvasEmbedRequest = z.infer<typeof canvasEmbedRequest>;

/**
 * Commit one embedded document node through the guarded commit path, and track
 * its reference in the same flush. The caller already recorded the mention.
 */
export async function embedCanvasDocument(
  session: CanvasSession,
  request: CanvasEmbedRequest
) {
  const { action: _action, itemId, mentionId, ...node } = request;
  const outcome = await session.apply(
    [{ ...node, kind: 'embedDocument', id: itemId }],
    { references: { [mentionId]: request.documentId } }
  );
  return {
    itemId,
    canvas: null,
    operationsApplied: outcome.operationsApplied,
    summary: `Embedded ${request.name || 'a document'} on the canvas.`,
    usage: [],
  };
}
