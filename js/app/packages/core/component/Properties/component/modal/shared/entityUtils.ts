import type { IUser } from '@core/user';
import type { EntityData, EmailEntity } from '@entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Accessor } from 'solid-js';
import type { FreshSortConfig, TimestampedItem } from '@core/util/freshSort';
import {
  useQuickAccess,
  type QuickAccessItem,
  type Bucket,
} from '@core/context/quickAccess';

/**
 * Maps EntityType to quickAccess buckets
 */
export function entityTypeToBuckets(
  entityType: EntityType | null | undefined
): Bucket[] | null {
  if (!entityType) return null; // null means "all"
  switch (entityType) {
    case 'USER':
      return ['person'];
    case 'CHANNEL':
      return ['channel', 'dm'];
    case 'DOCUMENT':
      return ['document', 'note'];
    case 'PROJECT':
      return ['project'];
    case 'CHAT':
      return ['chat'];
    case 'TASK':
      return ['task'];
    case 'THREAD':
      return ['email']; // Note: emails aren't in quickAccess yet, handled separately
    case 'COMPANY':
      return []; // Companies aren't in quickAccess
    default:
      return null;
  }
}

/**
 * Hook to get QuickAccessItems for a given EntityType.
 * Returns items from the appropriate buckets based on entity type.
 */
export function useQuickAccessEntities(
  entityType: Accessor<EntityType | null | undefined>
): { items: Accessor<QuickAccessItem[]>; isLoading: Accessor<boolean> } {
  const quickAccess = useQuickAccess();

  const buckets = () => entityTypeToBuckets(entityType());
  const items = (): QuickAccessItem[] => {
    const b = buckets();
    if (b === null) {
      return quickAccess.useList()();
    }
    if (b.length === 0) {
      return [];
    }
    return quickAccess.useList(...b)();
  };
  return { items, isLoading: quickAccess.isLoading };
}

/** Combined entity type for unified handling across entity selectors */
export type CombinedEntity =
  | { kind: 'entity'; id: string; data: EntityData }
  | { kind: 'user'; id: string; data: IUser };

/** Converts a QuickAccessItem to CombinedEntity */
export function quickAccessItemToEntity(item: QuickAccessItem): CombinedEntity {
  if (item.kind === 'user') {
    return { kind: 'user', id: item.id, data: item.data };
  }
  return { kind: 'entity', id: item.id, data: item.data };
}

/** Maps an EntityData to a CombinedEntity */
export function entityDataToEntity(data: EntityData): CombinedEntity {
  return { kind: 'entity', id: data.id, data };
}

/** Maps an IUser to a CombinedEntity */
export function userToEntity(user: IUser): CombinedEntity {
  return { kind: 'user', id: user.id, data: user };
}

/** Maps an email entity to a CombinedEntity (alias for entityDataToEntity) */
export function threadMapper(email: EmailEntity): CombinedEntity {
  return entityDataToEntity(email);
}

/** Gets the display name for an entity */
export function getEntityName(entity: CombinedEntity): string {
  if (entity.kind === 'user') {
    const { name, email } = entity.data;
    if (name === email) return email;
    return name;
  }

  const data = entity.data;
  if (data.type === 'email') {
    return data.name ?? 'No Subject';
  }
  return data.name ?? '';
}

/** Gets searchable text for an entity (used with createFreshSearch) */
export function getEntitySearchText(entity: CombinedEntity): string {
  if (entity.kind === 'user') {
    const { name, email } = entity.data;
    if (name === email) return `${email} | ${email}`;
    return `${name} | ${email}`;
  }

  return entity.data.name ?? '';
}

/** Gets the EntityType string for an entity */
export function getEntityType(entity: CombinedEntity): EntityType {
  if (entity.kind === 'user') {
    return 'USER';
  }

  const data = entity.data;
  switch (data.type) {
    case 'channel':
      return 'CHANNEL';
    case 'document':
      if (data.subType?.type === 'task') {
        return 'TASK';
      }
      return 'DOCUMENT';
    case 'chat':
      return 'CHAT';
    case 'project':
      return 'PROJECT';
    case 'email':
      return 'THREAD';
    default:
      return (data as EntityData).type.toUpperCase() as EntityType;
  }
}

/** Check if entity is a channel */
export function isChannelEntity(item: CombinedEntity): boolean {
  return item.kind === 'entity' && item.data.type === 'channel';
}

/** Get timestamped item from combined entity */
export function getEntityTimestampedItem<T extends CombinedEntity>(
  item: T
): TimestampedItem {
  if (item.kind === 'user') {
    return {
      lastInteraction: item.data.lastInteraction,
    };
  }

  const data = item.data;
  return {
    updatedAt: data.updatedAt,
    viewedAt: data.viewedAt,
  };
}

/**
 * Creates search config for entity searches with same-domain boost.
 * Uses the same preset as MentionsMenu and RecipientSelector for consistency.
 */
export function createEntitySearchConfig<T extends CombinedEntity>(
  currentUserDomain: Accessor<string | undefined>
): FreshSortConfig<T> {
  const boostFn = (item: T): number => {
    const userDomain = currentUserDomain();
    if (!userDomain) return 0;

    // Check if this is a user entity with email
    if (item.kind === 'user' && item.data.email) {
      const email = item.data.email;
      const itemDomain = email.split('@')[1];
      return itemDomain === userDomain ? 0.5 : 0;
    }

    return 0;
  };

  return {
    fuzzyWeight: 0.5,
    timeWeight: 0.4,
    brevityWeight: 0.1,
    boostFn,
  };
}
