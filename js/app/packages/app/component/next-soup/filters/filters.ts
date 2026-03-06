import {
  getEntityProjectId,
  getTaskAssigneeIds,
  isTaskEntity,
  type TaskEntityWithProperties,
  type EntityData,
  type WithNotification,
  isChannelEntity,
  isChatEntity,
  isDocumentEntity,
  isEmailEntity,
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
import type {
  SoupApiItem,
  SoupProperty,
} from '@service-storage/generated/schemas';
import { codeFileExtensions } from '@block-code/util/languageSupport';
import type { FilterConfig, FilterGroupConfig } from './create-filter-state';
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
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const EXCLUDE: string[] = [NIL_UUID];

/** Base filter that excludes all entity types by default */
export const QUERY_FILTERS_BASE: SoupItemsQueryFilters = {
  channel_filters: { channel_ids: EXCLUDE },
  chat_filters: { chat_ids: EXCLUDE },
  document_filters: { document_ids: EXCLUDE },
  email_filters: { recipients: EXCLUDE },
  project_filters: { project_ids: EXCLUDE },
};

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

type EntityFilterConfig = FilterConfig<EntityData> & { label?: string };

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
export function notDoneFilter(notificationSource: NotificationSource) {
  return function (entity: WithNotification<EntityData>) {
    if (entity.type === 'email') return !entity.done;
    // Tasks are handled by signalFilter based on assignee/status, not notifications
    if (isTaskEntity(entity)) return true;

    const notifications =
      notificationSource.notificationsByEntity()[compositeEntity(entity)];

    return notifications?.some(({ done }) => !done);
  };
}

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

export function hasCalendarInviteFilter(entity: EntityData): boolean {
  if (entity.type !== 'email') return false;

  return entity.hasIcsAttachment === true;
}

const ICS_MIME_TYPE = 'application/ics';

export function hasAttachmentFilter(entity: EntityData): boolean {
  if (entity.type !== 'email') return false;

  const filteredAttachments = entity.attachments?.filter(
    (a) => a.mimeType !== ICS_MIME_TYPE
  );

  return (filteredAttachments?.length ?? 0) > 0;
}

const PDF_MIME_TYPES = ['application/pdf'];
const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];
const DOCUMENT_MIME_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];

function hasAttachmentOfType(entity: EntityData, mimeTypes: string[]): boolean {
  if (entity.type !== 'email') return false;
  if (!entity.attachments?.length) return false;

  return entity.attachments.some((a) => {
    if (!a.mimeType) return false;
    return mimeTypes.some((type) => a.mimeType?.startsWith(type));
  });
}

export function hasPdfAttachmentFilter(entity: EntityData): boolean {
  return hasAttachmentOfType(entity, PDF_MIME_TYPES);
}

export function hasImageAttachmentFilter(entity: EntityData): boolean {
  return hasAttachmentOfType(entity, IMAGE_MIME_TYPES);
}

export function hasDocumentAttachmentFilter(entity: EntityData): boolean {
  return hasAttachmentOfType(entity, DOCUMENT_MIME_TYPES);
}

export function sharedEntity(getUserID: () => string | undefined) {
  return function (entity: EntityData): boolean {
    const userID = getUserID();
    if (userID == null) return false;

    return entity.ownerId !== userID;
  };
}

/** Filter for agents (chats) owned by the current user */
export function ownedAgentFilter(getUserID: () => string | undefined) {
  return function (entity: EntityData): boolean {
    if (entity.type !== 'chat') return false;
    const userID = getUserID();
    if (userID == null) return false;

    return entity.ownerId === userID;
  };
}

/** Filter for agents (chats) shared with the current user (owned by someone else) */
export function sharedAgentFilter(getUserID: () => string | undefined) {
  return function (entity: EntityData): boolean {
    if (entity.type !== 'chat') return false;
    const userID = getUserID();
    if (userID == null) return false;

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

export function hasProperties(
  entity: EntityData
): entity is EntityData & { properties: SoupProperty[] } {
  return 'properties' in entity && Array.isArray(entity.properties);
}

export function getPropertyById(
  entity: EntityData,
  propertyId: string
): SoupProperty | undefined {
  if (!hasProperties(entity)) return undefined;

  return entity.properties.find((p) => p.definition.id === propertyId);
}

export function hasAssignees(entity: EntityData): boolean {
  if (!isTaskEntity(entity)) return false;
  return getTaskAssigneeIds(entity).length > 0;
}

export function isAssignedTo(entity: EntityData, userId: string): boolean {
  if (!isTaskEntity(entity)) return false;

  const assigneeIds = getTaskAssigneeIds(entity);
  // If no assignees, consider it assigned to everyone (or unassigned)
  if (assigneeIds.length === 0) return false;
  return assigneeIds.includes(userId);
}

export function isUnassigned(entity: EntityData): boolean {
  if (!isTaskEntity(entity)) return false;
  return getTaskAssigneeIds(entity).length === 0;
}

export function getStatusOptionId(entity: EntityData): string | undefined {
  if (!isTaskEntity(entity)) return undefined;
  const taskWithProps = entity as TaskEntityWithProperties;

  const properties = taskWithProps.properties;

  if (!properties) return undefined;

  const statusProperty = properties.find(
    (p) => p.definition.id === SYSTEM_PROPERTY_IDS.STATUS
  );

  if (!statusProperty?.value) return undefined;

  const value = statusProperty.value;

  if (value.type === 'SelectOption') {
    return value.value[0];
  }

  return undefined;
}

export function hasStatus(entity: EntityData, statusOptionId: string): boolean {
  return getStatusOptionId(entity) === statusOptionId;
}

export function isNotStarted(entity: EntityData): boolean {
  return hasStatus(entity, PROPERTY_OPTION_IDS.STATUS.NOT_STARTED);
}

export function isInProgress(entity: EntityData): boolean {
  return hasStatus(entity, PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS);
}

export function isInReview(entity: EntityData): boolean {
  return hasStatus(entity, PROPERTY_OPTION_IDS.STATUS.IN_REVIEW);
}

export function isCompleted(entity: EntityData): boolean {
  if (!isTaskEntity(entity)) return false;
  // Check both the subType flag and status property
  if (entity.subType?.is_completed) return true;
  return hasStatus(entity, PROPERTY_OPTION_IDS.STATUS.COMPLETED);
}

export function isCanceled(entity: EntityData): boolean {
  return hasStatus(entity, PROPERTY_OPTION_IDS.STATUS.CANCELED);
}

export function isClosed(entity: EntityData): boolean {
  return isCompleted(entity) || isCanceled(entity);
}

export function isOpen(entity: EntityData): boolean {
  if (!isTaskEntity(entity)) return false;
  return !isClosed(entity);
}

export function getPriorityOptionId(entity: EntityData): string | undefined {
  if (!isTaskEntity(entity)) return undefined;
  const taskWithProps = entity as TaskEntityWithProperties;

  const properties = taskWithProps.properties;

  if (!properties) return undefined;

  const priorityProperty = properties.find(
    (p) => p.definition.id === SYSTEM_PROPERTY_IDS.PRIORITY
  );

  if (!priorityProperty?.value) return undefined;

  const value = priorityProperty.value;

  if (value.type === 'SelectOption') {
    return value.value[0];
  }

  return undefined;
}

export function hasPriority(
  entity: EntityData,
  priorityOptionId: string
): boolean {
  return getPriorityOptionId(entity) === priorityOptionId;
}

export function isUrgentPriority(entity: EntityData): boolean {
  return hasPriority(entity, PROPERTY_OPTION_IDS.PRIORITY.URGENT);
}

export function isHighPriority(entity: EntityData): boolean {
  return hasPriority(entity, PROPERTY_OPTION_IDS.PRIORITY.HIGH);
}

export function isMediumPriority(entity: EntityData): boolean {
  return hasPriority(entity, PROPERTY_OPTION_IDS.PRIORITY.MEDIUM);
}

export function isLowPriority(entity: EntityData): boolean {
  return hasPriority(entity, PROPERTY_OPTION_IDS.PRIORITY.LOW);
}

export function hasNoPriority(entity: EntityData): boolean {
  if (!isTaskEntity(entity)) return false;
  return getPriorityOptionId(entity) === undefined;
}

export const ENTITY_TYPE_FILTER_CONFIGS = [
  // Entity type filters (mutually exclusive)
  {
    id: 'document',
    label: 'Docs',
    predicate: documentFilter,
    group: 'entity-type',
  },
  {
    id: 'agent',
    label: 'Agents',
    predicate: agentFilter,
    group: 'entity-type',
  },
  {
    id: 'people',
    label: 'People',
    predicate: peopleFilter,
    group: 'entity-type',
  },
  {
    id: 'teams',
    label: 'Teams',
    predicate: teamsFilter,
    group: 'entity-type',
  },
  {
    id: 'task',
    label: 'Tasks',
    predicate: taskFilter,
    group: 'entity-type',
  },
  {
    id: 'email',
    label: 'Mail',
    predicate: emailFilter,
    group: 'entity-type',
  },
  {
    id: 'file',
    label: 'Files',
    predicate: fileFilter,
    group: 'entity-type',
  },
] as const;

export const EMAIL_CONTEXTUAL_FILTERS: EntityFilterConfig[] = [
  {
    id: 'email-unread',
    label: 'Unread',
    predicate: (entity) => isEmailEntity(entity) && !entity.isRead,
  },
  {
    id: 'email-read',
    label: 'Read',
    predicate: (entity) => isEmailEntity(entity) && entity.isRead,
  },
  {
    id: 'email-done',
    label: 'Done',
    predicate: (entity) => isEmailEntity(entity) && entity.done,
  },
  {
    id: 'email-not-done',
    label: 'Not Done',
    predicate: (entity) => isEmailEntity(entity) && !entity.done,
  },
];

export const TASK_STATUS_FILTERS: EntityFilterConfig[] = [
  {
    id: 'task-not-started',
    label: 'Not Started',
    predicate: isNotStarted,
  },
  {
    id: 'task-in-progress',
    label: 'In Progress',
    predicate: isInProgress,
  },
  {
    id: 'task-in-review',
    label: 'In Review',
    predicate: isInReview,
  },
  {
    id: 'task-completed',
    label: 'Completed',
    predicate: isCompleted,
  },
  {
    id: 'task-canceled',
    label: 'Canceled',
    predicate: isCanceled,
  },
];

export const TASK_PRIORITY_FILTERS: EntityFilterConfig[] = [
  {
    id: 'task-critical',
    label: 'Critical',
    predicate: isUrgentPriority,
  },
  {
    id: 'task-high-priority',
    label: 'High Priority',
    predicate: isHighPriority,
  },
  {
    id: 'task-medium-priority',
    label: 'Medium Priority',
    predicate: isMediumPriority,
  },
  {
    id: 'task-low-priority',
    label: 'Low Priority',
    predicate: isLowPriority,
  },
  {
    id: 'task-no-priority',
    label: 'No Priority',
    predicate: hasNoPriority,
  },
];

export const TASK_ASSIGNEE_FILTERS: EntityFilterConfig[] = [
  {
    id: 'task-has-assignee',
    label: 'Has Assignee',
    predicate: hasAssignees,
  },
  {
    id: 'task-unassigned',
    label: 'Unassigned',
    predicate: isUnassigned,
  },
];

export const TASK_CONTEXTUAL_FILTERS: EntityFilterConfig[] = [
  ...TASK_STATUS_FILTERS,
  ...TASK_PRIORITY_FILTERS,
  ...TASK_ASSIGNEE_FILTERS,
];

export const DOCUMENT_CONTEXTUAL_FILTERS: EntityFilterConfig[] = [
  {
    id: 'doc-recent',
    label: 'Recently Edited',
    predicate: (entity) => {
      if (!isDocumentEntity(entity)) return false;
      const updatedAt = entity.updatedAt
        ? new Date(entity.updatedAt)
        : undefined;
      if (!updatedAt) return false;
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return updatedAt > dayAgo;
    },
  },
  {
    id: 'doc-edited-this-week',
    label: 'Edited This Week',
    predicate: (entity) => {
      if (!isDocumentEntity(entity)) return false;
      const updatedAt = entity.updatedAt
        ? new Date(entity.updatedAt)
        : undefined;
      if (!updatedAt) return false;
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return updatedAt > weekAgo;
    },
  },
  {
    id: 'in-folder',
    label: 'In Folder',
    predicate: (entity) => !!getEntityProjectId(entity),
  },
  {
    id: 'doc-markdown',
    label: 'Markdown',
    predicate: (entity) => isDocumentEntity(entity) && entity.fileType === 'md',
  },
  {
    id: 'doc-canvas',
    label: 'Canvas',
    predicate: (entity) =>
      isDocumentEntity(entity) && entity.fileType === 'canvas',
  },
];

export const CHANNEL_CONTEXTUAL_FILTERS: EntityFilterConfig[] = [
  {
    id: 'channel-recent-activity',
    label: 'Recent Activity',
    predicate: (entity) => {
      if (!isChannelEntity(entity)) return false;
      const interactedAt = entity.interactedAt
        ? new Date(entity.interactedAt)
        : undefined;
      if (!interactedAt) return false;
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return interactedAt > dayAgo;
    },
  },
  {
    id: 'channel-public',
    label: 'Public',
    predicate: (entity) =>
      isChannelEntity(entity) && entity.channelType === 'public',
  },
  {
    id: 'channel-private',
    label: 'Private',
    predicate: (entity) =>
      isChannelEntity(entity) && entity.channelType === 'private',
  },
];

export const CHAT_CONTEXTUAL_FILTERS: EntityFilterConfig[] = [
  {
    id: 'chat-recent',
    label: 'Recent',
    predicate: (entity) => {
      if (!isChatEntity(entity)) return false;
      const updatedAt = entity.updatedAt
        ? new Date(entity.updatedAt)
        : undefined;
      if (!updatedAt) return false;
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return updatedAt > dayAgo;
    },
  },
];

/**
 * Agent ownership filter options for the filter bar.
 * Note: The actual predicates are registered in createSoupFilters with getUserID closure.
 * These are just the IDs and labels for building filter UI options.
 */
export const AGENT_OWNERSHIP_FILTERS: readonly { id: string; label: string }[] =
  [
    { id: 'owned-agent', label: 'Owned by me' },
    { id: 'shared-agent', label: 'Shared with me' },
  ] as const;

export const GENERAL_CONTEXTUAL_FILTERS: EntityFilterConfig[] = [
  {
    id: 'recently-viewed',
    label: 'Recently Viewed',
    predicate: (entity) => {
      const viewedAt = entity.viewedAt ? new Date(entity.viewedAt) : undefined;
      if (!viewedAt) return false;
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return viewedAt > hourAgo;
    },
  },
  {
    id: 'recently-created',
    label: 'Recently Created',
    predicate: (entity) => {
      const createdAt = entity.createdAt
        ? new Date(entity.createdAt)
        : undefined;
      if (!createdAt) return false;
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return createdAt > weekAgo;
    },
  },
  {
    id: 'recently-updated',
    label: 'Recently Updated',
    predicate: (entity) => {
      const updatedAt = entity.updatedAt
        ? new Date(entity.updatedAt)
        : undefined;
      if (!updatedAt) return false;
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return updatedAt > dayAgo;
    },
  },
  {
    id: 'high-frecency',
    label: 'Frequently Used',
    predicate: (entity) => {
      const score = entity.frecencyScore ?? 0;
      return score > 100; // High frecency threshold
    },
  },
];

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] as const;

export const FILE_TYPE_FILTERS: EntityFilterConfig[] = [
  {
    id: 'file-code',
    label: 'Code',
    predicate: (entity) => {
      if (entity.type !== 'document') return false;
      const fileType = entity.fileType ?? '';
      return (codeFileExtensions as readonly string[]).includes(fileType);
    },
  },
  {
    id: 'file-image',
    label: 'Images',
    predicate: (entity) => {
      if (entity.type !== 'document') return false;
      const fileType = entity.fileType ?? '';
      return (IMAGE_EXTENSIONS as readonly string[]).includes(fileType);
    },
  },
  {
    id: 'file-pdf',
    label: 'PDFs',
    predicate: (entity) => {
      if (entity.type !== 'document') return false;
      return entity.fileType === 'pdf';
    },
  },
  {
    id: 'file-other',
    label: 'Other',
    predicate: (entity) => {
      if (entity.type !== 'document') return false;
      const fileType = entity.fileType ?? '';
      // Exclude markdown, canvas, code, images, and PDFs
      if (['md', 'canvas'].includes(fileType)) return false;
      if ((codeFileExtensions as readonly string[]).includes(fileType))
        return false;
      if ((IMAGE_EXTENSIONS as readonly string[]).includes(fileType))
        return false;
      if (fileType === 'pdf') return false;
      return true;
    },
  },
];

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
      id: 'read',
      label: 'Read',
      predicate: (entity: EntityData) =>
        !unreadFilter(notificationSource)(entity),
    },
    {
      id: 'not-done',
      label: 'Not done',
      predicate: notDoneFilter(notificationSource),
    },
    {
      id: 'done',
      label: 'Done',
      predicate: (entity: EntityData) =>
        !notDoneFilter(notificationSource)(entity),
    },
    ...ENTITY_TYPE_FILTER_CONFIGS,
    {
      id: 'channels',
      label: 'Channels',
      predicate: channelsFilter,
    },
    {
      id: 'file-folder',
      label: 'Files & Folders',
      predicate: filesAndFolderFilter,
    },
    {
      id: 'folders',
      label: 'Folders',
      predicate: projectFilter,
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
      id: 'has-calendar-invite',
      label: 'Has calendar invite',
      predicate: hasCalendarInviteFilter,
    },
    {
      id: 'has-attachment',
      label: 'Has attachment',
      predicate: hasAttachmentFilter,
    },
    {
      id: 'attachment-pdf',
      label: 'PDF attachment',
      predicate: hasPdfAttachmentFilter,
    },
    {
      id: 'attachment-image',
      label: 'Image attachment',
      predicate: hasImageAttachmentFilter,
    },
    {
      id: 'attachment-document',
      label: 'Document attachment',
      predicate: hasDocumentAttachmentFilter,
    },
    {
      id: 'shared-entity',
      label: 'Shared entities',
      predicate: sharedEntity(getUserID),
    },
    {
      id: 'owned-agent',
      label: 'Owned by me',
      predicate: ownedAgentFilter(getUserID),
    },
    {
      id: 'shared-agent',
      label: 'Shared with me',
      predicate: sharedAgentFilter(getUserID),
    },
    {
      id: 'assigned-to',
      label: 'Task assigned to user',
      predicate: taskAssignedToUserFilter(getUserID),
    },
    ...TASK_PRIORITY_FILTERS,
    ...DOCUMENT_CONTEXTUAL_FILTERS,
    ...CHANNEL_CONTEXTUAL_FILTERS,
    ...CHAT_CONTEXTUAL_FILTERS,
    ...FILE_TYPE_FILTERS,
  ] as const satisfies EntityFilterConfig[];

  return list;
};

/**
 * Default filter group configurations for soup filters.
 * - 'focus': Mutually exclusive (signal/noise/explicit-noise)
 * - 'entity-type': Mutually exclusive by default
 */
export const SOUP_FILTER_GROUPS: FilterGroupConfig[] = [
  { id: 'focus', allowMultiple: false },
  { id: 'entity-type', allowMultiple: false },
];

type SoupFilter = ReturnType<typeof createSoupFilters>[number];

export type FilterID = Extract<SoupFilter, { id: string & {} }>['id'];

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
