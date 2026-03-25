import { isEntityType } from '@core/types/utils';
import type { DateValue } from '@core/util/date';
import type { ApiLabel } from '@service-email/generated/schemas';
import type {
  SoupLabel,
  SoupProperty,
} from '@service-storage/generated/schemas';
import type { JSX } from 'solid-js';

export type EntityBase = {
  id: string;
  name: string;
  ownerId: string;
  frecencyScore?: number;
  createdAt?: DateValue | null;
  updatedAt?: DateValue | null;
  viewedAt?: DateValue | null;
};

export type ChannelEntity = EntityBase & {
  type: 'channel';
  channelType:
    | 'direct_message'
    | 'private'
    | 'organization'
    | 'public'
    | 'team';
  interactedAt?: DateValue | null;
  participantIds?: string[];
  latestMessage?: {
    content: string;
    senderId: string;
    createdAt: DateValue;
  };
};

export type ChatEntity = EntityBase & {
  type: 'chat';
  projectId?: string;
};

/** Named sub types - currently only 'task' */
export type NamedSubType = 'task';

/** SubType for documents - currently only tasks */
export type SubType = {
  type: NamedSubType;
  is_completed?: boolean;
} | null;

export type BaseDocumentEntity = EntityBase & {
  type: 'document';
  fileType?: string;
  projectId?: string;
  subType?: SubType;
  properties?: SoupProperty[];
};

export type TaskEntity = EntityBase & {
  type: 'document';
  fileType: 'md';
  subType: { type: 'task'; is_completed?: boolean };
  projectId?: string;
};

export type MarkdownEntity = EntityBase & {
  type: 'document';
  fileType: 'md';
  subType?: null;
  projectId?: string;
};

export type DocumentEntity = BaseDocumentEntity | MarkdownEntity;

export const getEntityProjectId = (e: EntityData): string | false => {
  return 'projectId' in e ? (e.projectId ?? false) : false;
};

export type EmailThreadParticipants = Array<{ email: string; name?: string }>;

export type EmailAttachment = {
  id: string;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

// We spread ApiThreadPreviewCursor into the email entity, should we explcitly include all those fields here, or only add them as needed?
export type EmailEntity = EntityBase & {
  type: 'email';
  isRead: boolean;
  isDraft: boolean;
  snippet?: string;
  isImportant: boolean;
  done: boolean;
  projectId?: string;
  participants?: EmailThreadParticipants;
  senderEmail?: string;
  senderName?: string;
  labels?: SoupLabel[] | ApiLabel[];
  hasIcsAttachment?: boolean;
  attachments?: EmailAttachment[];
};

export type ProjectEntity = EntityBase & {
  type: 'project';
  projectId?: string;
};

export type EntityData =
  | ChannelEntity
  | ChatEntity
  | DocumentEntity
  | TaskEntity
  | EmailEntity
  | ProjectEntity;

export const isEntityData = (item: unknown): item is EntityData => {
  if (typeof item !== 'object') return false;

  if (!item) return false;

  if (!('type' in item)) return false;

  if (typeof item.type !== 'string') return false;

  return isEntityType(item.type);
};

export const isTaskEntity = (entity: EntityData): entity is TaskEntity => {
  return (
    entity.type === 'document' &&
    entity.fileType === 'md' &&
    entity.subType?.type === 'task'
  );
};

export const isChannelEntity = (
  entity: EntityData
): entity is ChannelEntity => {
  return entity.type === 'channel';
};

export const isChatEntity = (entity: EntityData): entity is ChatEntity => {
  return entity.type === 'chat';
};

export const isEmailEntity = (entity: EntityData): entity is EmailEntity => {
  return entity.type === 'email';
};

export const isProjectEntity = (
  entity: EntityData
): entity is ProjectEntity => {
  return entity.type === 'project';
};

export const isDocumentEntity = (
  entity: EntityData
): entity is DocumentEntity => {
  return entity.type === 'document';
};

export const isMarkdownEntity = (
  entity: EntityData
): entity is MarkdownEntity => {
  return (
    entity.type === 'document' && entity.fileType === 'md' && !entity.subType
  );
};

export const isPureDocumentEntity = (
  entity: EntityData
): entity is DocumentEntity => {
  return entity.type === 'document' && entity.subType?.type !== 'task';
};

export type EntityType = EntityData['type'];

export type ExpandedEntityType = EntityType | 'task';

export type EntityWithProperties<T extends EntityData> = T & {
  properties?: SoupProperty[];
};

export type TaskEntityWithProperties = EntityWithProperties<TaskEntity>;

export type EntityOf<K extends EntityType> = Extract<EntityData, { type: K }>;

export type EntityMapper<T extends EntityData> = (entity: EntityData) => T;

export type EntityEnhancer<T extends EntityData> = (
  entity: EntityData,
  index?: number,
  array?: EntityData[]
) => T;

export type EntityFilter<T extends EntityData> = (entity: T) => boolean;

export type EntitiesFilter<T extends EntityData> = (entities: T[]) => T[];

export type EntityComparator<T extends EntityData> = (a: T, b: T) => number;

export type EntityRenderer<T extends EntityData> = (props: {
  entity: T;
  index: number;
}) => JSX.Element;

export type ProjectContainedEntity<T extends EntityData = EntityData> = T & {
  projectId: string;
};

export const isProjectContainedEntity = <T extends EntityData>(
  entity: T
): entity is ProjectContainedEntity<T> => {
  return getEntityProjectId(entity) !== false;
};

/**
 * Utility type that makes only specified fields required from an EntityData type,
 * while all other fields become optional.
 * @example
 * type MinimalEntity = PartialEntity<'id' | 'name'>;
 */
export type PartialEntity<K extends keyof EntityData = keyof EntityData> = Pick<
  EntityData,
  K
> &
  Partial<Omit<EntityData, K>>;
