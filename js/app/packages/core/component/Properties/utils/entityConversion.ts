import type { EntityReference } from '@service-properties/generated/schemas/entityReference';

/**
 * Converts EntityReference[] to Set of entity IDs for compatibility with EntityInput
 */
export function entityReferencesToIdSet(refs: EntityReference[]): Set<string> {
  return new Set(refs.map((ref) => ref.entity_id));
}

/**
 * Updates entity references based on new selection
 * Handles adding/removing entities and determining entity types
 */
export function updateEntityReferences(
  currentRefs: EntityReference[],
  newSelectedIds: Set<string>,
  entityInfo?: Array<{ id: string; entity_type: string }>
): EntityReference[] {
  const currentIds = new Set(currentRefs.map((ref) => ref.entity_id));

  // Find entities that were added and removed
  const addedIds = Array.from(newSelectedIds).filter(
    (id) => !currentIds.has(id)
  );
  const removedIds = Array.from(currentIds).filter(
    (id) => !newSelectedIds.has(id)
  );

  // Remove entities that were deselected
  let updatedRefs = currentRefs.filter(
    (ref) => !removedIds.includes(ref.entity_id)
  );

  // Add new entities with proper entity type
  for (const id of addedIds) {
    const entityType =
      entityInfo?.find((info) => info.id === id)?.entity_type || 'DOCUMENT';
    updatedRefs.push({
      entity_id: id,
      entity_type: entityType as EntityReference['entity_type'],
    });
  }

  return updatedRefs;
}
