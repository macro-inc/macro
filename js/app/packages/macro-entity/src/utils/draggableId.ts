/**
 * Creates a draggable ID for an entity
 * Format: entityId-splitId (if splitId exists) or just entityId
 */
export function createDraggableId(entityId: string, splitId?: string): string {
  return splitId ? `${entityId}-${splitId}` : entityId;
}

/**
 * Extracts the entity ID from a draggable ID
 * Removes the split ID suffix if present (format: entityId-splitId)
 */
export function extractEntityId(draggableId: string): string {
  const parts = draggableId.split('-');
  if (parts.length <= 1) return draggableId;
  return parts.slice(0, -1).join('-');
}

/**
 * Extracts the split ID from a draggable ID
 * Returns the last segment after splitting by '-'
 */
export function extractSplitId(draggableId: string): string | undefined {
  const parts = draggableId.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}
