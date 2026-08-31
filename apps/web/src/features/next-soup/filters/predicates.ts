import {
  type EntityData,
  getCompanyOwnerId,
  getCompanyStageOptionId,
  getTaskAssigneeIds,
  getTaskStatusOptionId,
  isGithubPrEntity,
  isTaskEntity,
  type TaskEntityWithProperties,
  toNotificationEntity,
  type WithNotification,
} from '@entity';
import { getTaskPriorityOptionId } from '@entity/utils/task-properties';
import { compositeEntity, type NotificationSource } from '@notifications';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { NO_ASSIGNEE, NO_STAGE } from './configs/base';

function getPredicateNotifications(
  entity: EntityData,
  notificationSource: NotificationSource
) {
  const attachedNotifications = (entity as WithNotification<EntityData>)
    .notifications;

  if (typeof attachedNotifications === 'function') {
    return attachedNotifications();
  }

  if (Array.isArray(attachedNotifications)) return attachedNotifications;

  return notificationSource.notificationsByEntity()[
    compositeEntity(toNotificationEntity(entity))
  ];
}

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

    const notifications = getPredicateNotifications(entity, notificationSource);

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

    const notifications = getPredicateNotifications(entity, notificationSource);

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
    (entity.type === 'channel' ||
      entity.type === 'channel_message' ||
      entity.type === 'channel_thread') &&
    entity.channelType === 'direct_message'
  );
}

export function teamsFilter(entity: EntityData): boolean {
  return (
    (entity.type === 'channel' ||
      entity.type === 'channel_message' ||
      entity.type === 'channel_thread') &&
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

export function githubPrFilter(entity: EntityData): boolean {
  return isGithubPrEntity(entity);
}

export function channelsFilter(entity: EntityData): boolean {
  // Non-member team channels (surfaced by the Teams tab) must not leak into
  // Recent through the shared soup cache; message/thread rows only exist for
  // channels the user is in.
  if (entity.type === 'channel') return entity.isParticipant !== false;
  return entity.type === 'channel_message' || entity.type === 'channel_thread';
}

export function callsFilter(entity: EntityData): boolean {
  return entity.type === 'call';
}

export function calendarEventFilter(entity: EntityData): boolean {
  return entity.type === 'calendar_event';
}

export function crmCompanyFilter(entity: EntityData): boolean {
  return entity.type === 'crm_company';
}

export function remindersFilter(entity: EntityData): boolean {
  return entity.type === 'reminder';
}

/**
 * Reminders that have fired and are waiting on their owner.
 *
 * `completedAt` means the owner has dealt with the reminder, and firing
 * deliberately does not set it — so a fired one is outstanding, not finished.
 * The `nextRunAt` test is what separates these from reminders that simply have
 * not come due yet; those live in Scheduled.
 */
export function firedRemindersFilter(entity: EntityData): boolean {
  return (
    entity.type === 'reminder' &&
    !entity.completedAt &&
    new Date(entity.nextRunAt).getTime() <= Date.now()
  );
}

/**
 * Reminders set for the future, which have not fired yet. Recurring reminders
 * never complete, so between firings they sit here pointing at their next run.
 */
export function scheduledRemindersFilter(entity: EntityData): boolean {
  return (
    entity.type === 'reminder' &&
    !entity.completedAt &&
    new Date(entity.nextRunAt).getTime() > Date.now()
  );
}

/** Reminders the owner has marked as dealt with. */
export function doneRemindersFilter(entity: EntityData): boolean {
  return entity.type === 'reminder' && !!entity.completedAt;
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

/**
 * Stage filter for companies, driven by the view's stage selection
 * (`ctx.stages`). `NO_STAGE` matches companies without a Stage set. Stage
 * resolution goes through `resolveStage` (the team's active deal-stage
 * set, from `ctx.resolveCompanyStage`) when supplied, so the filter
 * buckets companies exactly like the kanban — legacy system-stage values
 * included; otherwise it falls back to the raw system Stage value.
 */
export function companyStageFilter(
  stageIds: () => string[] | undefined,
  resolveStage?: (entity: EntityData) => string | undefined
) {
  return (entity: EntityData): boolean => {
    const stages = stageIds();
    if (!stages?.length) return true;
    if (entity.type !== 'crm_company') return false;
    const stageId = resolveStage
      ? resolveStage(entity)
      : getCompanyStageOptionId(entity);
    return stages.some((id) =>
      id === NO_STAGE ? stageId === undefined : stageId === id
    );
  };
}

/**
 * Owner filter for companies, driven by the view's owner selection
 * (`ctx.owners`). `NO_OWNER` matches companies without an Owner set.
 */
export function companyOwnedByUsersFilter(
  ownerIds: () => string[] | undefined
) {
  return (entity: EntityData): boolean => {
    const owners = ownerIds();
    if (!owners?.length) return true;
    if (entity.type !== 'crm_company') return false;
    const ownerId = getCompanyOwnerId(entity);
    return owners.some((id) =>
      id === NO_ASSIGNEE ? ownerId === undefined : ownerId === id
    );
  };
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
