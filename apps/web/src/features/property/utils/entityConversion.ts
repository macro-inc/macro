import { type EntityData, isTaskEntity } from '@entity';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyTargetEntityType } from '@service-properties/generated/schemas/propertyTargetEntityType';
import type { ItemType } from '@service-storage/client';
import { match } from 'ts-pattern';

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

/** `undefined` means the entity type has no item-preview surface. */
export function entityTypeToItemType(type: EntityType): ItemType | undefined {
  return match<EntityType, ItemType | undefined>(type)
    .with('TASK', () => 'document')
    .with('DOCUMENT', () => 'document')
    .with('PROJECT', () => 'project')
    .with('CHANNEL', () => 'channel')
    .with('CHAT', () => 'chat')
    .with('CALL_RECORD', () => 'call')
    .with('THREAD', () => 'email')
    .with('COMPANY', 'USER', 'CALENDAR_EVENT', () => undefined)
    .exhaustive();
}

export function macroEntityToPropertyEntityType(
  entity: EntityData
): PropertyTargetEntityType {
  return match(entity)
    .when(isTaskEntity, () => EntityType.DOCUMENT)
    .with({ type: 'channel' }, () => EntityType.CHANNEL)
    .with({ type: 'chat' }, () => EntityType.CHAT)
    .with({ type: 'project' }, () => EntityType.PROJECT)
    .with({ type: 'email' }, () => EntityType.THREAD)
    .with({ type: 'document' }, () => EntityType.DOCUMENT)
    .with({ type: 'channel_message' }, () => EntityType.CHANNEL)
    .with({ type: 'channel_thread' }, () => EntityType.CHANNEL)
    .with({ type: 'call' }, () => EntityType.CALL_RECORD)
    .with({ type: 'crm_company' }, () => EntityType.COMPANY)
    .with({ type: 'crm_contact' }, () => {
      // No CONTACT in the properties-service EntityType yet.
      throw new Error('crm contacts do not support properties');
    })
    .with({ type: 'automation' }, () => {
      throw new Error('automation entities do not support properties');
    })
    .with({ type: 'foreign' }, () => {
      throw new Error('foreign entities do not support properties');
    })
    .with({ type: 'reminder' }, () => {
      throw new Error('reminders do not support properties');
    })
    .with({ type: 'calendar_event' }, () => {
      // CALENDAR_EVENT is not a property-editing target on the frontend yet.
      throw new Error('calendar events do not support properties');
    })
    .exhaustive();
}
