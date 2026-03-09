import type {
  FilterConfig,
  FilterGroupConfig,
} from '@app/component/next-soup/filters/create-filter-state';
import {
  isNotStarted,
  isInProgress,
  isInReview,
  isCompleted,
  isCanceled,
  isUrgentPriority,
  isHighPriority,
  isMediumPriority,
  isLowPriority,
  hasNoPriority,
  hasAssignees,
  isUnassigned,
  channelsFilter,
  filesAndFolderFilter,
  activeAgentFilter,
  emailDraftsFilter,
  noDraftsFilter,
  hasCalendarInviteFilter,
  hasAttachmentFilter,
  hasPdfAttachmentFilter,
  hasImageAttachmentFilter,
  hasDocumentAttachmentFilter,
  sharedEntity,
  ownedAgentFilter,
  sharedAgentFilter,
  taskAssignedToUserFilter,
  agentFilter,
  documentFilter,
  emailFilter,
  fileFilter,
  notDoneFilter,
  peopleFilter,
  projectFilter,
  taskFilter,
  teamsFilter,
  unreadFilter,
} from '@app/component/next-soup/filters/predicates';
import {
  signalFilter,
  noiseFilter,
  explicitNoiseFilter,
} from '@app/component/next-soup/filters/signal-filters';
import { codeFileExtensions } from '@block-code/util/languageSupport';
import {
  type EntityData,
  isEmailEntity,
  isDocumentEntity,
  getEntityProjectId,
  isChannelEntity,
  isChatEntity,
} from '@entity';
import type { NotificationSource } from '@notifications';

type EntityFilterConfig = FilterConfig<EntityData> & { label?: string };

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
