import {
  getTaskAssigneeIds,
  isTaskEntity,
  type TaskEntityWithProperties,
  type EntityData,
  type WithNotification,
} from '@entity';
import {
  signalFilter,
  noiseFilter,
  explicitNoiseFilter,
} from './signal-filters';
import {
  type EntityWithValidIcon,
  getIconConfig,
} from '@core/component/EntityIcon';
import type { SoupBody, SoupItemsQueryFilters } from '@queries/soup/items';
import type { SoupApiItem } from '@service-storage/generated/schemas';
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
import { match } from 'ts-pattern';
import { compositeEntity, type NotificationSource } from '@notifications';

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

function isIdFilteredOut(ids: string[] | undefined, value: string): boolean {
  if (!ids || ids.length === 0) return false;
  return !ids.includes(value);
}

//  TODO: this only supports for item type and id filters, other filters to be added later
export function filterSoupItemByRequestBody(
  item: SoupApiItem,
  body: SoupBody
): boolean {
  return match(item)
    .with(
      { tag: 'document' },
      ({ data }) =>
        !isIdFilteredOut(body.document_filters?.document_ids, data.id)
    )
    .with(
      { tag: 'chat' },
      ({ data }) => !isIdFilteredOut(body.chat_filters?.chat_ids, data.id)
    )
    .with(
      { tag: 'channel' },
      ({ data }) =>
        !isIdFilteredOut(body.channel_filters?.channel_ids, data.channel.id)
    )
    .with(
      { tag: 'project' },
      ({ data }) => !isIdFilteredOut(body.project_filters?.project_ids, data.id)
    )
    .with(
      { tag: 'emailThread' },
      ({ data }) =>
        !isIdFilteredOut(body.email_filters?.email_thread_ids, data.id)
    )
    .exhaustive();
}

/**
 * Unread filter - entity has unread content.
 *
 * Entity-specific logic:
 * - Emails: Uses `isRead` boolean field
 * - Everything else: Has at least one notification with viewedAt === null
 */
export function unreadFilter(notificationSource: NotificationSource) {
  return function (entity: EnhancedEntity): boolean {
    if (entity.type === 'email') {
      return !entity.isRead;
    }
    const notifications =
      notificationSource.notificationsByEntity()[compositeEntity(entity)];

    return notifications?.some((n) => !n.viewed_at) ?? false;
  };
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

export function filesAndFolderFilter(entity: EntityData): boolean {
  if (entity.type !== 'project' && entity.type !== 'document') return false;

  if (entity.type === 'document') {
    const fileType = entity.fileType ?? '';
    return !['md', 'canvas'].includes(fileType);
  }

  return true;
}

export function activeAgentFilter(entity: EntityData): boolean {
  if (entity.type !== 'chat') return false;

  // [TODO] Check status of agent
  return true;
}

export function emailDraftsFilter(entity: EntityData): boolean {
  if (entity.type !== 'email') return false;

  return entity.isDraft;
}

export function noDraftsFilter(entity: EntityData): boolean {
  if (entity.type !== 'email') return false;

  return !entity.isDraft;
}

export function sharedDocumentFilter(getUserID: () => string | undefined) {
  return function (entity: EntityData): boolean {
    const userID = getUserID();
    if (entity.type !== 'document' || userID == null) return false;

    return entity.ownerId !== userID;
  };
}

export function taskAssignedToUserFilter(getUserID: () => string | undefined) {
  return function (entity: EntityData): boolean {
    const userID = getUserID();
    if (!isTaskEntity(entity) || userID == null) return false;

    const taskEntity = entity as unknown as TaskEntityWithProperties;
    return getTaskAssigneeIds(taskEntity).includes(userID);
  };
}

export const ENTITY_TYPE_FILTER_CONFIGS = [
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
] as const;

export const createSoupFilters = (
  notificationSource: NotificationSource,
  getUserID: () => string | undefined
) => {
  const list = [
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
      predicate: unreadFilter(notificationSource),
    },
    {
      id: 'not-done',
      label: 'Not done',
      predicate: notDoneFilter,
    },
    ...ENTITY_TYPE_FILTER_CONFIGS,
    {
      id: 'channels',
      label: 'Channels',
      predicate: channelsFilter,
      group: 'type',
    },
    {
      id: 'file-folder',
      label: 'Files & Folders',
      predicate: filesAndFolderFilter,
    },
    {
      id: 'active-agent',
      label: 'Running agents',
      predicate: activeAgentFilter,
    },
    {
      id: 'email-drafts',
      label: 'Email drafts',
      predicate: emailDraftsFilter,
    },
    {
      id: 'no-drafts',
      label: 'No drafts',
      predicate: noDraftsFilter,
    },
    {
      id: 'shared-document',
      label: 'Shared documents',
      predicate: sharedDocumentFilter(getUserID),
    },
    {
      id: 'assigned-to',
      label: 'Task assigned to user',
      predicate: taskAssignedToUserFilter(getUserID),
    },
  ] as const satisfies (FilterConfig<EntityData> & { label: string })[];

  return list;
};

type SoupFilter = ReturnType<typeof createSoupFilters>[number];

export type FilterID = SoupFilter['id'];

const ENTITY_TYPE_FILTERS = [
  'document',
  'task',
  'email',
  'people',
  'teams',
  'agent',
  'file',
] as const satisfies FilterID[];

type EntityTypeFilters = (typeof ENTITY_TYPE_FILTERS)[number];

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

export const FILE_ASSOCIATION_TYPES = [
  'code',
  'image',
  'pdf',
  'unknown',
] as const;

/** Expands file association types to file extensions for soup or search */
export const getFileAssociations = (type: 'soup' | 'search') => {
  return FILE_ASSOCIATION_TYPES.flatMap((fileType) => {
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
    document_filters: { file_types: getFileAssociations('soup') },
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
