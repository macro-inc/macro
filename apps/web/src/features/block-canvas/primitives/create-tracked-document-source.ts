import type { CanvasDocumentSource } from '../context/document-source';
import type { CanvasReferenceSource } from '../context/reference-source';
import type { CanvasFile } from '../core/document-format';
import { canvasReferenceTargets } from '../core/references';

/** Called by serialized document persistence, so tracking follows saved snapshots. */
export function createTrackedCanvasDocumentSource(
  sourceId: string,
  initial: CanvasFile,
  documentSource: CanvasDocumentSource,
  references: CanvasReferenceSource
): CanvasDocumentSource {
  // A file copied to a different canvas must never remove the original's mentions.
  const stored =
    initial.referenceTracking?.sourceId === sourceId
      ? initial.referenceTracking
      : undefined;
  const active = new Map(
    stored?.mentions.map(({ targetId, mentionId }) => [targetId, mentionId])
  );
  const retiring = new Set(stored?.pendingRemoval);
  const requireEdit = () => {
    if (!documentSource.canEdit()) throw new Error('This canvas is read-only');
  };
  return {
    canEdit: documentSource.canEdit,
    async save(canvas) {
      requireEdit();
      const targets = canvasReferenceTargets(canvas.document);
      for (const [target, mention] of active) {
        if (targets.has(target)) continue;
        retiring.add(mention);
        active.delete(target);
      }
      for (const target of targets) {
        if (active.has(target)) continue;
        requireEdit();
        active.set(target, await references.create(target));
      }
      requireEdit();
      const file = await documentSource.save({
        ...canvas,
        referenceTracking: {
          sourceId,
          mentions: Array.from(active, ([targetId, mentionId]) => ({
            targetId,
            mentionId,
          })),
          pendingRemoval: [...retiring],
        },
      });
      // Never untrack a card until its deletion is durable. On failure these IDs
      // remain both in memory and in the saved file for an idempotent retry.
      for (const mention of retiring) {
        requireEdit();
        await references.remove(mention);
        retiring.delete(mention);
      }
      return file;
    },
  };
}
