import { isEntityType } from '@core/types/utils';
import type {
  APIEmailThreadPreviewMetadata,
  ApiLabel,
} from '@service-email/generated/schemas';
import type {
  SoupEmailThreadPreviewMetadata,
  SoupLabel,
} from '@service-storage/generated/schemas';
import type { JSX } from 'solid-js';

export type EntityBase = {
  id: string;
  name: string;
  ownerId: string;
  frecencyScore?: number;
  createdAt?: number;
  updatedAt?: number;
  viewedAt?: number;
};

export type ChannelEntity = EntityBase & {
  type: 'channel';
  channelType: 'direct_message' | 'private' | 'organization' | 'public';
  interactedAt?: number;
  particpantIds?: string[];
  latestMessage?: {
    content: string;
    senderId: string;
    createdAt: number;
  };
};

export type ChatEntity = EntityBase & {
  type: 'chat';
  projectId?: string;
};

export type BaseDocumentEntity = EntityBase & {
  type: 'document';
  fileType?: string;
  projectId?: string;
  subType?: string;
};

export type TaskEntity = EntityBase & {
  type: 'document';
  fileType: 'md';
  subType: 'task';
  projectId?: string;
};

export type MarkdownEntity = EntityBase & {
  type: 'document';
  fileType: 'md';
  subType?: null;
  projectId?: string;
};

export type DocumentEntity = BaseDocumentEntity | MarkdownEntity;

export type NamedSubType = 'task';

export const getEntityProjectId = (e: EntityData): string | false => {
  if (e.type === 'project') {
    return 'parentId' in e ? (e.parentId ?? false) : false;
  }
  return 'projectId' in e ? (e.projectId ?? false) : false;
};

// We spread ApiThreadPreviewCursor into the email entity, should we explcitly include all those fields here, or only add them as needed?
export type EmailEntity = EntityBase & {
  type: 'email';
  isRead: boolean;
  snippet?: string;
  isImportant: boolean;
  done: boolean;
  participants?: Array<{ email: string; name: string }>;
  senderEmail?: string;
  senderName?: string;
  labels?: SoupLabel[] | ApiLabel[];
  metadata?: SoupEmailThreadPreviewMetadata | APIEmailThreadPreviewMetadata;
};

export type ProjectEntity = EntityBase & {
  type: 'project';
  parentId?: string;
};

// Create new entity types above this comment
// Then add it to the EntityData union below

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
    entity.subType === 'task'
  );
};

export const isPureDocumentEntity = (
  entity: EntityData
): entity is DocumentEntity => {
  return entity.type === 'document' && !entity.subType;
};

export type EntityType = EntityData['type'];

export type ExpandedEntityType = EntityType | NamedSubType;

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
