import { type EntityData, isTaskEntity } from '@entity/types/entity';
import {
  EntityType,
  type EntityType as PropertyEntityType,
} from '@service-properties/generated/schemas/entityType';
import { match, P } from 'ts-pattern';

/** Property-service entity types that currently support tags in the UI. */
const TAGGABLE_ENTITY_TYPES: ReadonlySet<PropertyEntityType> = new Set([
  EntityType.DOCUMENT,
  EntityType.TASK,
  EntityType.THREAD,
  EntityType.PROJECT,
  EntityType.CHAT,
  EntityType.CALL_RECORD,
]);

export function isTaggableEntityType(entityType: PropertyEntityType): boolean {
  return TAGGABLE_ENTITY_TYPES.has(entityType);
}

/** Resolve a full Macro entity to the identity used by tag mutations. */
export function tagEntityType(
  entity: EntityData
): PropertyEntityType | undefined {
  if (isTaskEntity(entity)) return EntityType.TASK;

  return match(entity.type)
    .with('document', () => EntityType.DOCUMENT)
    .with('email', () => EntityType.THREAD)
    .with('project', () => EntityType.PROJECT)
    .with('chat', () => EntityType.CHAT)
    .with('call', () => EntityType.CALL_RECORD)
    .with(
      P.union(
        'channel',
        'channel_message',
        'channel_thread',
        'crm_company',
        'crm_contact',
        'automation',
        'reminder',
        'calendar_event',
        'foreign'
      ),
      () => undefined
    )
    .exhaustive();
}

/**
 * Whether tags can be offered for a tag-mutation target: either a full Macro
 * entity, or the minimal `{ entityType }` shape the property editor accepts
 * when no full entity is available (the second arm of PropertyEditorEntity).
 */
export function canTagEntity(
  entity: EntityData | { entityType: PropertyEntityType }
): boolean {
  if ('entityType' in entity) return isTaggableEntityType(entity.entityType);
  return tagEntityType(entity) !== undefined;
}
