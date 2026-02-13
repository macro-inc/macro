import { isTaskEntity, type EntityData, type WithNotification } from '@entity';
import {
  signalFilter,
  noiseFilter,
  explicitNoiseFilter,
} from './signal-filters';
import {
  type EntityWithValidIcon,
  getIconConfig,
} from '@core/component/EntityIcon';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import { codeFileExtensions } from '@block-code/util/languageSupport';
import type { FilterConfig } from './create-filter-state';
import type { Component } from 'solid-js';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedChatIcon } from '@macro-icons/wide/animating/chat';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { ChannelTypeEnum } from '@service-comms/client';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Array containing NIL_UUID, used to exclude an entity type from query results.
 *
 * @example
 * ```ts
 * filters.set({
 *   query: {
 *     chat_filters: { chat_ids: EXCLUDE },  // Exclude all chats
 *   }
 * });
 * ```
 */
export const EXCLUDE: string[] = [NIL_UUID];

/**
 * Unread filter - entity has unread content.
 *
 * Entity-specific logic:
 * - Emails: Uses `isRead` boolean field
 * - Everything else: Has at least one notification with viewedAt === null
 */
export function unreadFilter(entity: EnhancedEntity): boolean {
  if (entity.type === 'email') {
    return !entity.isRead;
  }
  return entity.notifications?.()?.some((n) => !n.viewedAt) ?? false;
}

/**
 * NotDone filter - entity has outstanding items.
 *
 * Entity-specific logic:
 * - Emails: Uses `done` field (derived from !inboxVisible - email is "not done" when in inbox)
 * - Everything else: Has at least one notification with done === false
 */
export function notDoneFilter(entity: WithNotification<EntityData>) {
  if (entity.type === 'email') return !entity.done;
  // Tasks are handled by signalFilter based on assignee/status, not notifications
  if (isTaskEntity(entity)) return true;

  return (
    !!entity.notifications && entity.notifications().some(({ done }) => !done)
  );
}

/** Filter group configuration */
export type FilterGroup = {
  readonly id: string;
  readonly allowMultiple?: boolean;
};

/** Filter group configurations */
export const FILTER_GROUPS: readonly FilterGroup[] = [
  { id: 'focus', allowMultiple: false },
  { id: 'type', allowMultiple: false },
];

type EnhancedEntity = WithNotification<EntityData>;

/** Document filter (markdown, canvas) - excludes tasks */
export function documentFilter(entity: EntityData): boolean {
  if (entity.type !== 'document') return false;
  if (entity.subType?.type === 'task') return false;
  const fileType = entity.fileType ?? '';
  return fileType === 'md' || fileType === 'canvas';
}

/** Task filter */
export function taskFilter(entity: EntityData): boolean {
  return entity.type === 'document' && entity.subType?.type === 'task';
}

/** Email filter */
export function emailFilter(entity: EntityData): boolean {
  return entity.type === 'email';
}

/** People filter (direct messages) */
export function peopleFilter(entity: EntityData): boolean {
  return entity.type === 'channel' && entity.channelType === 'direct_message';
}

/** Teams filter (group channels) */
export function teamsFilter(entity: EntityData): boolean {
  return entity.type === 'channel' && entity.channelType !== 'direct_message';
}

/** Chat/agent filter */
export function agentFilter(entity: EntityData): boolean {
  return entity.type === 'chat';
}

/** Project/folder filter */
export function projectFilter(entity: EntityData): boolean {
  return entity.type === 'project';
}

/** File filter (non-markdown documents) */
export function fileFilter(entity: EntityData): boolean {
  if (entity.type !== 'document') return false;
  const fileType = entity.fileType ?? '';
  return !['md', 'canvas'].includes(fileType);
}

export function channelsFilter(entity: EntityData): boolean {
  return entity.type === 'channel';
}

export const SOUP_FILTERS = [
  // Focus filters (mutually exclusive)
  {
    id: 'signal',
    label: 'Inbox',
    predicate: signalFilter,
    group: 'focus',
  },
  {
    id: 'noise',
    label: 'Other',
    predicate: noiseFilter,
    group: 'focus',
  },
  {
    id: 'explicit-noise',
    label: 'Explicit Noise',
    predicate: (entity: EntityData) => !explicitNoiseFilter(entity),
    group: 'focus',
  },

  // Notification filters
  {
    id: 'unread',
    label: 'Unread',
    predicate: unreadFilter,
  },
  {
    id: 'not-done',
    label: 'Not done',
    predicate: notDoneFilter,
  },

  // Entity type filters (mutually exclusive)
  {
    id: 'document',
    label: 'Docs',
    predicate: documentFilter,
    group: 'type',
  },
  {
    id: 'agent',
    label: 'Agents',
    predicate: agentFilter,
    group: 'type',
  },
  {
    id: 'people',
    label: 'People',
    predicate: peopleFilter,
    group: 'type',
  },
  {
    id: 'teams',
    label: 'Teams',
    predicate: teamsFilter,
    group: 'type',
  },
  {
    id: 'task',
    label: 'Tasks',
    predicate: taskFilter,
    group: 'type',
  },
  {
    id: 'email',
    label: 'Mail',
    predicate: emailFilter,
    group: 'type',
  },
  {
    id: 'file',
    label: 'Files',
    predicate: fileFilter,
    group: 'type',
  },
  {
    id: 'channels',
    label: 'Channels',
    predicate: channelsFilter,
    group: 'type',
  },
] as const;

export type FilterID = (typeof SOUP_FILTERS)[number]['id'];

const ENTITY_TYPE_FILTERS = [
  'document',
  'task',
  'email',
  'people',
  'teams',
  'agent',
  'file',
] as const;

type EntityTypeFilters = (typeof ENTITY_TYPE_FILTERS)[number];

export const isEntityTypeFilter = (
  filter: FilterConfig<EntityData>
): filter is Extract<
  (typeof SOUP_FILTERS)[number],
  { readonly id: EntityTypeFilters }
> => {
  return ENTITY_TYPE_FILTERS.includes(filter.id as EntityTypeFilters);
};

export const ENTITY_TYPE_FILTER_CONFIGS = SOUP_FILTERS.filter((f) =>
  isEntityTypeFilter(f)
);

const ENTITY_TYPE_TO_ICON_TYPE: Record<EntityTypeFilters, EntityWithValidIcon> =
  {
    document: 'md',
    email: 'email',
    task: 'task',
    people: 'channel',
    teams: 'direct_message',
    agent: 'chat',
    file: 'project',
  };

export const getEntityTypeFilterIcon = (filter: EntityTypeFilters) => {
  return getIconConfig(ENTITY_TYPE_TO_ICON_TYPE[filter]);
};

/**
 * Mapping of entity type filter IDs to their animated icon components.
 * Used to provide hover animations on filter buttons.
 */
export const ANIMATED_ICONS: Partial<
  Record<EntityTypeFilters, Component<{ triggerAnimation?: boolean }>>
> = {
  document: AnimatedFileMdIcon,
  agent: AnimatedStarIcon,
  people: AnimatedChatIcon,
  teams: AnimatedChannelIcon,
  task: AnimatedTaskIcon,
  email: AnimatedEmailIcon,
  file: AnimatedFolderIcon,
};

export const getFilterWithID = (filterID: FilterID) => {
  const found = SOUP_FILTERS.find((f) => f.id === filterID);

  if (!found) return;

  return found;
};

export const FOLDER_DOCUMENT_TYPES = [
  'code',
  'image',
  'pdf',
  'unknown',
] as const;

export const getFolderFileTypes = (type: 'soup' | 'search') => {
  return FOLDER_DOCUMENT_TYPES.flatMap((fileType) => {
    if (fileType === 'code')
      return type === 'soup' ? ['assoc:code'] : codeFileExtensions;
    if (fileType === 'image')
      return type === 'soup' ? ['assoc:image'] : [NIL_UUID];
    if (fileType === 'unknown')
      return type === 'soup' ? ['assoc:other'] : [NIL_UUID];
    return [fileType];
  });
};

export const QUERY_FILTERS = {
  /** Docs filter - markdown and canvas documents (excludes tasks) */
  document: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    document_filters: { file_types: ['md', 'canvas'] },
  },

  /** Tasks filter - markdown documents with task subType */
  task: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    document_filters: { file_types: ['md'] },
  },

  /** Mail filter - emails */
  email: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    email_filters: {},
  },

  /** People filter - direct message channels */
  people: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: { channel_types: [ChannelTypeEnum.DirectMessage] },
  },

  /** Teams filter - group channels (non-DM) */
  teams: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: {
      channel_types: [
        ChannelTypeEnum.Private,
        ChannelTypeEnum.Organization,
        ChannelTypeEnum.Public,
      ],
    },
  },

  /** Agents filter - chats */
  agent: {
    channel_filters: { channel_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    chat_filters: {},
  },

  /** Files filter - non-markdown documents (code, images, pdfs, etc.) */
  file: {
    channel_filters: { channel_ids: EXCLUDE },
    chat_filters: { chat_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    document_filters: { file_types: getFolderFileTypes('soup') },
  },

  /** Channels filter - all channels (teams and people) */
  channels: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: {},
  },

  /** Default - include all entity types (no filter active) */
  default: {},
} satisfies Record<string, SoupItemsQueryFilters>;

export type QueryFilterKey = keyof typeof QUERY_FILTERS;
