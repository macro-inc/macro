import { EntityType as BaseEntityType } from '@service-connection/generated/schemas';

// NOTE: TEMP
export const EntityType = {
  ...BaseEntityType,
  email: 'email',
} as const;

export type EntityType = (typeof EntityType)[keyof typeof EntityType];

export type EntityId = string;
export type Entity = {
  id: EntityId;
  type: EntityType;
};

export type { ApiPaginatedThreadCursor as ThreadPreview } from '@service-email/generated/schemas/apiPaginatedThreadCursor';
import type { NotifEvent } from '@service-notification/generated/schemas';
export type NotificationType = NotifEvent['tag'];

export type Nullable<T> = T | null;
export type Maybe<T> = T | undefined;

export type MaybePromise<T> = T | Promise<T>;
