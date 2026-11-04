import type { GraphicsDocument } from '@macro-inc/graphics';

/** Tracking belongs to the canvas file, not individual copyable shapes. */
export type CanvasReferenceTracking = {
  sourceId: string;
  mentions: { targetId: string; mentionId: string }[];
  /** Deletions run after saving and remain durable until a later save prunes them. */
  pendingRemoval: string[];
};

export function canvasReferenceTargets(
  document: GraphicsDocument
): Set<string> {
  return new Set(
    Object.values(document.items).flatMap((item) =>
      item.type === 'document' &&
      (!item.geometry.entityType || item.geometry.entityType === 'document')
        ? [item.geometry.documentId]
        : []
    )
  );
}
