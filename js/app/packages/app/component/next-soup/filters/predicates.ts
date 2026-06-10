import {
  type EntityData,
  getTaskAssigneeIds,
  getTaskStatusOptionId,
  isTaskEntity,
  type TaskEntityWithProperties,
  toNotificationEntity,
  type WithNotification,
} from '@entity';
import { getTaskPriorityOptionId } from '@entity/utils/task-properties';
import { compositeEntity, type NotificationSource } from '@notifications';
import { PROPERTY_OPTION_IDS } from '@property/constants';

/**
 * Unread filter - entity has unread content.
 *
 * Entity-specific logic:
 * - Emails: Uses `isRead` boolean field
 * - Everything else: Has at least one notification with viewedAt === null
 */
export function unreadFilter(notificationSource: NotificationSource) {
  return function (entity: EntityData): boolean {
    if (entity.type === 'email') {
      return !entity.isRead;
    }

    const notifications =
      notificationSource.notificationsByEntity()[
        compositeEntity(toNotificationEntity(entity))
      ];

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

    const notifications =
      notificationSource.notificationsByEntity()[
        compositeEntity(toNotificationEntity(entity))
      ];

    return notifications?.some(({ done }) => !done);
  };
}

/** Document filter (markdown, canvas) - excludes tasks */
export function documentFilter(entity: EntityData): boolean {
  if (entity.type !== 'document') return false;
  if (entity.subType?.type === 'task') return false;
  const fileType = entity.fileType ?? '';
  return fileType === 'md' || fileType === 'canvas';
}

export function taskFilter(entity: EntityData): boolean {
  return entity.type === 'document' && entity.subType?.type === 'task';
}

export function emailFilter(entity: EntityData): boolean {
  return entity.type === 'email';
}

export function peopleFilter(entity: EntityData): boolean {
  return (
    (entity.type === 'channel' || entity.type === 'channel_message') &&
    entity.channelType === 'direct_message'
  );
}

export function teamsFilter(entity: EntityData): boolean {
  return (
    (entity.type === 'channel' || entity.type === 'channel_message') &&
    entity.channelType !== 'direct_message'
  );
}

export function agentFilter(entity: EntityData): boolean {
  return entity.type === 'chat';
}

export function automationFilter(entity: EntityData): boolean {
  return entity.type === 'automation';
}

export function projectFilter(entity: EntityData): boolean {
  return entity.type === 'project';
}

export function fileFilter(entity: EntityData): boolean {
  if (entity.type !== 'document') return false;
  const fileType = entity.fileType ?? '';
  return !['md', 'canvas'].includes(fileType);
}

export function channelsFilter(entity: EntityData): boolean {
  return entity.type === 'channel' || entity.type === 'channel_message';
}

export function callsFilter(entity: EntityData): boolean {
  return entity.type === 'call';
}

export function crmCompanyFilter(entity: EntityData): boolean {
  return entity.type === 'crm_company';
}

/**
 * Entity types the search view supports. Mirrors the search preset's
 * server-side exclusions (foreign entities + CRM) so entities that enter
 * the soup cache outside the query — e.g. websocket-driven optimistic
 * inserts — don't surface in the search feed.
 */
export function searchSupportedFilter(entity: EntityData): boolean {
  return (
    entity.type !== 'foreign' &&
    entity.type !== 'crm_company' &&
    entity.type !== 'crm_contact'
  );
}

export function crmCompanyActiveFilter(entity: EntityData): boolean {
  return entity.type === 'crm_company' && !entity.hidden;
}

export function crmCompanyHiddenFilter(entity: EntityData): boolean {
  return entity.type === 'crm_company' && entity.hidden;
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

function _ownedAgentFilter(getUserID: () => string | undefined) {
  return function (entity: EntityData): boolean {
    if (entity.type !== 'chat') return false;
    const userID = getUserID();
    if (userID == null) return false;

    return entity.ownerId === userID;
  };
}

function _sharedAgentFilter(getUserID: () => string | undefined) {
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

function _hasAssignees(entity: EntityData): boolean {
  if (!isTaskEntity(entity)) return false;
  return getTaskAssigneeIds(entity).length > 0;
}

function _isAssignedTo(entity: EntityData, userId: string): boolean {
  if (!isTaskEntity(entity)) return false;

  const assigneeIds = getTaskAssigneeIds(entity);
  // If no assignees, consider it assigned to everyone (or unassigned)
  if (assigneeIds.length === 0) return false;
  return assigneeIds.includes(userId);
}

function _isUnassigned(entity: EntityData): boolean {
  if (!isTaskEntity(entity)) return false;
  return getTaskAssigneeIds(entity).length === 0;
}

function hasStatus(entity: EntityData, statusOptionId: string): boolean {
  if (!isTaskEntity(entity)) return false;
  return getTaskStatusOptionId(entity) === statusOptionId;
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

function isClosed(entity: EntityData): boolean {
  return isCompleted(entity) || isCanceled(entity);
}

export function isOpen(entity: EntityData): boolean {
  if (!isTaskEntity(entity)) return false;
  return !isClosed(entity);
}

function hasPriority(entity: EntityData, priorityOptionId: string): boolean {
  if (!isTaskEntity(entity)) return false;

  return getTaskPriorityOptionId(entity) === priorityOptionId;
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

  return getTaskPriorityOptionId(entity) === undefined;
}
