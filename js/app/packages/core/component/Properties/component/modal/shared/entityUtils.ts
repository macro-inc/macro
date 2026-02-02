import type { ChannelWithParticipants, IUser } from '@core/user';
import type { EmailEntity } from '@macro-entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Item } from '@service-storage/generated/schemas/item';
import type { Accessor } from 'solid-js';
import type { FreshSortConfig, TimestampedItem } from '@core/util/freshSort';

/** Combined entity type for unified handling across entity selectors */
export type CombinedEntity =
  | { kind: 'item'; id: string; data: Item }
  | { kind: 'user'; id: string; data: IUser }
  | { kind: 'channel'; id: string; data: ChannelWithParticipants }
  | { kind: 'company'; id: string; data: null }
  | { kind: 'thread'; id: string; data: EmailEntity };

/** Creates a mapper function for a specific entity kind */
export function entityMapper(kind: 'item' | 'user' | 'channel') {
  return (data: Item | IUser | ChannelWithParticipants): CombinedEntity => {
    return { kind, data, id: (data as { id: string }).id } as CombinedEntity;
  };
}

/** Maps an email entity to a CombinedEntity */
export function threadMapper(email: EmailEntity): CombinedEntity {
  return { kind: 'thread', id: email.id, data: email };
}

/** Gets the display name for an entity */
export function getEntityName(entity: CombinedEntity): string {
  switch (entity.kind) {
    case 'item':
      return entity.data.name;
    case 'user': {
      const { name, email } = entity.data;
      if (name === email) return email;
      return name;
    }
    case 'channel':
      return entity.data.name ?? '';
    case 'company':
      return entity.id;
    case 'thread':
      return entity.data.name ?? 'No Subject';
  }
}

/** Gets searchable text for an entity (used with createFreshSearch) */
export function getEntitySearchText(entity: CombinedEntity): string {
  switch (entity.kind) {
    case 'item':
      return entity.data.name;
    case 'user': {
      const { name, email } = entity.data;
      if (name === email) return `${email} | ${email}`;
      return `${name} | ${email}`;
    }
    case 'channel':
      return entity.data.name ?? '';
    case 'company':
      return entity.id;
    case 'thread':
      return entity.data.name ?? '';
  }
}

/** Gets the EntityType string for an entity */
export function getEntityType(entity: CombinedEntity): EntityType {
  switch (entity.kind) {
    case 'user':
      return 'USER';
    case 'channel':
      return 'CHANNEL';
    case 'item':
      if (
        entity.data.type === 'document' &&
        entity.data.subType?.type === 'task'
      ) {
        return 'TASK';
      }
      return entity.data.type.toUpperCase() as EntityType;
    case 'company':
      return 'COMPANY';
    case 'thread':
      return 'THREAD';
  }
}

/**
 * Creates search config for entity searches with same-domain boost.
 * Uses the same preset as MentionsMenu and RecipientSelector for consistency.
 */
export function createEntitySearchConfig(
  currentUserDomain: Accessor<string | undefined>
): FreshSortConfig {
  const boostFn = <T extends TimestampedItem>(item: T): number => {
    const userDomain = currentUserDomain();
    if (!userDomain) return 0;

    // Check if this looks like a CombinedEntity with user data
    if (item?.kind === 'user' && item?.data?.email) {
      const email = item.data.email as string;
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
