import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import {
  type EntityData,
  type TaskEntityWithProperties,
  isDocumentEntity,
  isTaskEntity,
  getEntityProjectId,
  getTaskAssigneeIds,
} from '@entity';
import type { NotificationSource } from '@notifications';
import { codeFileExtensions } from '@block-code/util/languageSupport';
import {
  signalFilter,
  noiseFilter,
  explicitNoiseFilter,
} from './inbox-filters';
import {
  documentFilter as documentPredicate,
  taskFilter as taskPredicate,
  emailFilter as emailPredicate,
  peopleFilter as peoplePredicate,
  teamsFilter as teamsPredicate,
  agentFilter as agentPredicate,
  projectFilter as projectPredicate,
  fileFilter as filePredicate,
  channelsFilter as channelsPredicate,
  filesAndFolderFilter as filesAndFolderPredicate,
  activeAgentFilter as activeAgentPredicate,
  emailDraftsFilter as emailDraftsPredicate,
  noDraftsFilter as noDraftsPredicate,
  hasCalendarInviteFilter as hasCalendarInvitePredicate,
  hasAttachmentFilter as hasAttachmentPredicate,
  hasPdfAttachmentFilter as hasPdfAttachmentPredicate,
  hasImageAttachmentFilter as hasImageAttachmentPredicate,
  hasDocumentAttachmentFilter as hasDocumentAttachmentPredicate,
  isNotStarted,
  isInProgress,
  isInReview,
  isCompleted,
  isCanceled,
  isOpen,
  isUrgentPriority,
  isHighPriority,
  isMediumPriority,
  isLowPriority,
  hasNoPriority,
  unreadFilter as unreadPredicate,
  notDoneFilter as notDonePredicate,
  sharedEntity as sharedEntityPredicate,
  ownedAgentFilter as ownedAgentPredicate,
  sharedAgentFilter as sharedAgentPredicate,
  taskAssignedToUserFilter as taskAssignedToUserPredicate,
} from './predicates';
import {
  defineFilter,
  ast,
  type FilterGroupConfig,
  type AstExpr,
} from './define-filter';

const NIL = '00000000-0000-0000-0000-000000000000';

export const explicitNoiseFilterDef = defineFilter({
  id: 'explicit-noise',
  group: 'focus',
  predicate: (e: EntityData) => !explicitNoiseFilter(e),
  ast: () => ({
    df: ast.neq('id', NIL),
    chanf: ast.neq('ChannelId', NIL),
    cf: ast.neq('ChatId', NIL),
    pf: ast.neq('ProjectId', NIL),
    ef: ast.neq('ThreadId', NIL),
    emailView: 'all',
  }),
});

export const documentFilter = defineFilter({
  id: 'document',
  group: 'entity-type',
  predicate: documentPredicate,
  ast: () => ({
    df: ast.and(
      ast.or(ast.eq('ft', 'md'), ast.eq('ft', 'canvas')),
      ast.neq('dst', 'task')
    ),
  }),
});

export const agentFilter = defineFilter({
  id: 'agent',
  group: 'entity-type',
  predicate: agentPredicate,
  ast: () => ({ cf: ast.neq('ChatId', NIL) }),
});

export const peopleFilter = defineFilter({
  id: 'people',
  group: 'entity-type',
  predicate: peoplePredicate,
  ast: () => ({ chanf: ast.eq('ChannelType', 'direct_message') }),
});

export const teamsFilter = defineFilter({
  id: 'teams',
  group: 'entity-type',
  predicate: teamsPredicate,
  ast: () => ({ chanf: ast.neq('ChannelType', 'direct_message') }),
});

export const taskFilter = defineFilter({
  id: 'task',
  group: 'entity-type',
  predicate: taskPredicate,
  ast: () => ({ df: ast.eq('dst', 'task') }),
});

export const emailFilter = defineFilter({
  id: 'email',
  group: 'entity-type',
  predicate: emailPredicate,
  ast: () => ({ ef: ast.neq('ThreadId', NIL) }),
});

export const fileFilter = defineFilter({
  id: 'file',
  group: 'entity-type',
  predicate: filePredicate,
  ast: () => ({
    df: ast.and(
      ast.neq('ft', 'md'),
      ast.and(ast.neq('ft', 'canvas'), ast.neq('dst', 'task'))
    ),
  }),
});

export const ENTITY_TYPE_FILTERS = [
  documentFilter,
  agentFilter,
  peopleFilter,
  teamsFilter,
  taskFilter,
  emailFilter,
  fileFilter,
] as const;

export const channelsFilter = defineFilter({
  id: 'channels',
  predicate: channelsPredicate,
  ast: () => ({ chanf: ast.neq('ChannelId', NIL) }),
});

export const filesAndFolderFilter = defineFilter({
  id: 'file-folder',
  predicate: filesAndFolderPredicate,
  ast: () => ({
    df: ast.and(ast.neq('ft', 'md'), ast.neq('ft', 'canvas')),
    pf: ast.neq('ProjectId', NIL),
  }),
});

export const projectFilter = defineFilter({
  id: 'folders',
  predicate: projectPredicate,
  ast: () => ({ pf: ast.neq('ProjectId', NIL) }),
});

export const activeAgentFilter = defineFilter({
  id: 'active-agent',
  predicate: activeAgentPredicate,
  ast: () => ({ cf: ast.neq('ChatId', NIL) }),
});

export const notTaskFilter = defineFilter({
  id: 'not-task',
  predicate: (e: EntityData) => !taskPredicate(e),
  ast: () => ({ df: ast.neq('dst', 'task') }),
});

export const documentOrFileFilter = defineFilter({
  id: 'document-or-file',
  predicate: (e: EntityData) => e.type === 'document' && !taskPredicate(e),
  ast: () => ({ df: ast.neq('dst', 'task') }),
});

export const inFolderFilter = defineFilter({
  id: 'in-folder',
  predicate: (e: EntityData) => !!getEntityProjectId(e),
  ast: () => ({ df: ast.neq('pid', NIL) }),
});

export const docMarkdownFilter = defineFilter({
  id: 'doc-markdown',
  predicate: (e: EntityData) => isDocumentEntity(e) && e.fileType === 'md',
  ast: () => ({ df: ast.eq('ft', 'md') }),
});

export const docCanvasFilter = defineFilter({
  id: 'doc-canvas',
  predicate: (e: EntityData) => isDocumentEntity(e) && e.fileType === 'canvas',
  ast: () => ({ df: ast.eq('ft', 'canvas') }),
});

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] as const;

// Helper to build OR of multiple file type conditions
const orFileTypes = (types: readonly string[]): AstExpr =>
  types.reduce(
    (acc, ft) => ast.or(acc, ast.eq('ft', ft)),
    ast.eq('ft', types[0])
  );

export const fileCodeFilter = defineFilter({
  id: 'file-code',
  predicate: (e: EntityData) => {
    if (e.type !== 'document') return false;
    const fileType = e.fileType ?? '';
    return (codeFileExtensions as readonly string[]).includes(fileType);
  },
  ast: () => ({
    df: orFileTypes(codeFileExtensions as unknown as readonly string[]),
  }),
});

export const fileImageFilter = defineFilter({
  id: 'file-image',
  predicate: (e: EntityData) => {
    if (e.type !== 'document') return false;
    const fileType = e.fileType ?? '';
    return (IMAGE_EXTENSIONS as readonly string[]).includes(fileType);
  },
  ast: () => ({ df: orFileTypes(IMAGE_EXTENSIONS) }),
});

export const filePdfFilter = defineFilter({
  id: 'file-pdf',
  predicate: (e: EntityData) => {
    if (e.type !== 'document') return false;
    return e.fileType === 'pdf';
  },
  ast: () => ({ df: ast.eq('ft', 'pdf') }),
});

export const fileDocxFilter = defineFilter({
  id: 'file-docx',
  predicate: (e: EntityData) => {
    if (e.type !== 'document') return false;
    return e.fileType === 'docx';
  },
  ast: () => ({ df: ast.eq('ft', 'docx') }),
});

export const fileOtherFilter = defineFilter({
  id: 'file-other',
  predicate: (e: EntityData) => {
    if (e.type !== 'document') return false;
    const fileType = e.fileType ?? '';
    if (['md', 'canvas'].includes(fileType)) return false;
    if ((codeFileExtensions as readonly string[]).includes(fileType))
      return false;
    if ((IMAGE_EXTENSIONS as readonly string[]).includes(fileType))
      return false;
    if (fileType === 'pdf') return false;
    if (fileType === 'docx') return false;
    return true;
  },
  // "Other" = documents that aren't any of the specific types - harder to express as AST
  // Just filter by documents that aren't tasks for now (client predicate does exact filtering)
  ast: () => ({ df: ast.neq('dst', 'task') }),
});

export const DOCUMENT_CONTEXTUAL_FILTERS = [
  inFolderFilter,
  docMarkdownFilter,
  docCanvasFilter,
] as const;

export const FILE_TYPE_FILTERS = [
  fileCodeFilter,
  fileImageFilter,
  filePdfFilter,
  fileDocxFilter,
  fileOtherFilter,
] as const;

export const activeTaskFilter = defineFilter({
  id: 'active-task',
  predicate: (e: EntityData) => taskPredicate(e) && isOpen(e),
  ast: () => ({
    df: ast.eq('dst', 'task'),
    propf: ast.and(
      ast.not(
        ast.propSelect(
          SYSTEM_PROPERTY_IDS.STATUS,
          PROPERTY_OPTION_IDS.STATUS.COMPLETED
        )
      ),
      ast.not(
        ast.propSelect(
          SYSTEM_PROPERTY_IDS.STATUS,
          PROPERTY_OPTION_IDS.STATUS.CANCELED
        )
      )
    ),
  }),
});

export const emailDraftsFilter = defineFilter({
  id: 'email-drafts',
  predicate: emailDraftsPredicate,
  ast: () => ({ ef: ast.neq('ThreadId', NIL), emailView: 'drafts' }),
});

export const noDraftsFilter = defineFilter({
  id: 'no-drafts',
  predicate: noDraftsPredicate,
  ast: () => ({ ef: ast.neq('ThreadId', NIL) }),
});

export const hasCalendarInviteFilter = defineFilter({
  id: 'has-calendar-invite',
  predicate: hasCalendarInvitePredicate,
  ast: () => ({ ef: ast.neq('ThreadId', NIL) }),
});

export const hasAttachmentFilter = defineFilter({
  id: 'has-attachment',
  predicate: hasAttachmentPredicate,
  ast: () => ({ ef: ast.neq('ThreadId', NIL) }),
});

export const attachmentPdfFilter = defineFilter({
  id: 'attachment-pdf',
  predicate: hasPdfAttachmentPredicate,
  ast: () => ({ ef: ast.neq('ThreadId', NIL) }),
});

export const attachmentImageFilter = defineFilter({
  id: 'attachment-image',
  predicate: hasImageAttachmentPredicate,
  ast: () => ({ ef: ast.neq('ThreadId', NIL) }),
});

export const attachmentDocumentFilter = defineFilter({
  id: 'attachment-document',
  predicate: hasDocumentAttachmentPredicate,
  ast: () => ({ ef: ast.neq('ThreadId', NIL) }),
});

export const taskNotStartedFilter = defineFilter({
  id: 'task-not-started',
  predicate: isNotStarted,
  ast: () => ({
    propf: ast.propSelect(
      SYSTEM_PROPERTY_IDS.STATUS,
      PROPERTY_OPTION_IDS.STATUS.NOT_STARTED
    ),
  }),
});

export const taskInProgressFilter = defineFilter({
  id: 'task-in-progress',
  predicate: isInProgress,
  ast: () => ({
    propf: ast.propSelect(
      SYSTEM_PROPERTY_IDS.STATUS,
      PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS
    ),
  }),
});

export const taskInReviewFilter = defineFilter({
  id: 'task-in-review',
  predicate: isInReview,
  ast: () => ({
    propf: ast.propSelect(
      SYSTEM_PROPERTY_IDS.STATUS,
      PROPERTY_OPTION_IDS.STATUS.IN_REVIEW
    ),
  }),
});

export const taskCompletedFilter = defineFilter({
  id: 'task-completed',
  predicate: isCompleted,
  ast: () => ({
    propf: ast.propSelect(
      SYSTEM_PROPERTY_IDS.STATUS,
      PROPERTY_OPTION_IDS.STATUS.COMPLETED
    ),
  }),
});

export const taskCanceledFilter = defineFilter({
  id: 'task-canceled',
  predicate: isCanceled,
  ast: () => ({
    propf: ast.propSelect(
      SYSTEM_PROPERTY_IDS.STATUS,
      PROPERTY_OPTION_IDS.STATUS.CANCELED
    ),
  }),
});

export const TASK_STATUS_FILTERS = [
  taskNotStartedFilter,
  taskInProgressFilter,
  taskInReviewFilter,
  taskCompletedFilter,
  taskCanceledFilter,
] as const;

export const taskCriticalFilter = defineFilter({
  id: 'task-critical',
  predicate: isUrgentPriority,
  ast: () => ({
    propf: ast.propSelect(
      SYSTEM_PROPERTY_IDS.PRIORITY,
      PROPERTY_OPTION_IDS.PRIORITY.URGENT
    ),
  }),
});

export const taskHighPriorityFilter = defineFilter({
  id: 'task-high-priority',
  predicate: isHighPriority,
  ast: () => ({
    propf: ast.propSelect(
      SYSTEM_PROPERTY_IDS.PRIORITY,
      PROPERTY_OPTION_IDS.PRIORITY.HIGH
    ),
  }),
});

export const taskMediumPriorityFilter = defineFilter({
  id: 'task-medium-priority',
  predicate: isMediumPriority,
  ast: () => ({
    propf: ast.propSelect(
      SYSTEM_PROPERTY_IDS.PRIORITY,
      PROPERTY_OPTION_IDS.PRIORITY.MEDIUM
    ),
  }),
});

export const taskLowPriorityFilter = defineFilter({
  id: 'task-low-priority',
  predicate: isLowPriority,
  ast: () => ({
    propf: ast.propSelect(
      SYSTEM_PROPERTY_IDS.PRIORITY,
      PROPERTY_OPTION_IDS.PRIORITY.LOW
    ),
  }),
});

export const taskNoPriorityFilter = defineFilter({
  id: 'task-no-priority',
  predicate: hasNoPriority,
  ast: () => ({ df: ast.eq('dst', 'task') }),
});

export const TASK_PRIORITY_FILTERS = [
  taskCriticalFilter,
  taskHighPriorityFilter,
  taskMediumPriorityFilter,
  taskLowPriorityFilter,
  taskNoPriorityFilter,
] as const;

export const sharedEntityFilter = (getUserID: () => string | undefined) =>
  defineFilter({
    id: 'shared-entity' as const,
    predicate: (e: EntityData) => sharedEntityPredicate(getUserID)(e),
    ast: () => {
      const userId = getUserID() ?? '';
      return {
        df: ast.neq('o', userId),
        cf: ast.neq('Owner', userId),
        pf: ast.neq('Owner', userId),
      };
    },
  });

export const ownedAgentFilterDef = (getUserID: () => string | undefined) =>
  defineFilter({
    id: 'owned-agent' as const,
    predicate: (e: EntityData) => ownedAgentPredicate(getUserID)(e),
    ast: () => ({ cf: ast.eq('Owner', getUserID() ?? '') }),
  });

export const sharedAgentFilterDef = (getUserID: () => string | undefined) =>
  defineFilter({
    id: 'shared-agent' as const,
    predicate: (e: EntityData) => sharedAgentPredicate(getUserID)(e),
    ast: () => ({ cf: ast.neq('Owner', getUserID() ?? '') }),
  });

export const assignedToFilter = (getUserID: () => string | undefined) =>
  defineFilter({
    id: 'assigned-to' as const,
    predicate: (e: EntityData) => taskAssignedToUserPredicate(getUserID)(e),
    ast: () => ({
      propf: ast.propEntity(SYSTEM_PROPERTY_IDS.ASSIGNEES, getUserID() ?? ''),
    }),
  });

/** Creates an assignee filter for a specific user ID */
export const createAssigneeFilter = (userId: string) =>
  defineFilter({
    id: `assignee:${userId}` as const,
    predicate: (e: EntityData) => {
      if (!isTaskEntity(e)) return false;
      const task = e as unknown as TaskEntityWithProperties;
      return getTaskAssigneeIds(task).includes(userId);
    },
    ast: () => ({
      propf: ast.propEntity(SYSTEM_PROPERTY_IDS.ASSIGNEES, userId),
    }),
  });

/** Filter for unassigned tasks */
export const unassignedFilter = defineFilter({
  id: 'unassigned',
  predicate: (e: EntityData) => {
    if (!isTaskEntity(e)) return false;
    const task = e as unknown as TaskEntityWithProperties;
    return getTaskAssigneeIds(task).length === 0;
  },
  ast: () => ({ df: ast.eq('dst', 'task') }),
});

export const unreadFilterDef = (notificationSource: NotificationSource) =>
  defineFilter({
    id: 'unread' as const,
    predicate: (e: EntityData) => unreadPredicate(notificationSource)(e),
    ast: () => ({
      df: ast.eq('ns', false),
      ef: ast.eq('NotificationSeen', false),
      chanf: ast.eq('NotificationSeen', false),
      cf: ast.eq('NotificationSeen', false),
      pf: ast.eq('NotificationSeen', false),
    }),
  });

export const readFilterDef = (notificationSource: NotificationSource) =>
  defineFilter({
    id: 'read' as const,
    predicate: (e: EntityData) => !unreadPredicate(notificationSource)(e),
    ast: () => ({
      df: ast.eq('ns', true),
      ef: ast.eq('NotificationSeen', true),
      chanf: ast.eq('NotificationSeen', true),
      cf: ast.eq('NotificationSeen', true),
      pf: ast.eq('NotificationSeen', true),
    }),
  });

export const notDoneFilterDef = (notificationSource: NotificationSource) =>
  defineFilter({
    id: 'not-done' as const,
    predicate: (e: EntityData) => notDonePredicate(notificationSource)(e),
    ast: () => ({
      df: ast.eq('nd', false),
      ef: ast.eq('NotificationDone', false),
      chanf: ast.eq('NotificationDone', false),
      cf: ast.eq('NotificationDone', false),
      pf: ast.eq('NotificationDone', false),
    }),
  });

export const inboxFilterDef = (notificationSource: NotificationSource) =>
  defineFilter({
    id: 'inbox',
    group: 'focus',
    predicate: (e: EntityData) =>
      signalFilter(e) && notDonePredicate(notificationSource)(e),
    ast: () => ({
      df: ast.eq('nd', false),
      ef: ast.and(
        ast.eq('NotificationDone', false),
        ast.eq('Importance', true)
      ),
      chanf: ast.eq('NotificationDone', false),
      cf: ast.eq('NotificationDone', false),
      pf: ast.eq('NotificationDone', false),

      emailView: 'inbox',
    }),
  });

export const noiseFilterDef = defineFilter({
  id: 'noise',
  group: 'focus',
  predicate: noiseFilter,
  ast: () => ({
    df: ast.eq('nd', false),
    ef: ast.and(ast.eq('NotificationDone', false), ast.eq('Importance', false)),
    chanf: ast.eq('NotificationDone', false),
    cf: ast.eq('NotificationDone', false),
    pf: ast.eq('NotificationDone', false),

    emailView: 'inbox',
  }),
});

export const doneFilterDef = (notificationSource: NotificationSource) =>
  defineFilter({
    id: 'done' as const,
    predicate: (e: EntityData) => !notDonePredicate(notificationSource)(e),
    ast: () => ({
      df: ast.eq('nd', true),
      ef: ast.eq('NotificationDone', true),
      chanf: ast.eq('NotificationDone', true),
      cf: ast.eq('NotificationDone', true),
      pf: ast.eq('NotificationDone', true),
    }),
  });

export const createSoupFilters = (
  notificationSource: NotificationSource,
  getUserID: () => string | undefined
) => {
  return [
    inboxFilterDef(notificationSource),
    noiseFilterDef,
    explicitNoiseFilterDef,
    unreadFilterDef(notificationSource),
    readFilterDef(notificationSource),
    notDoneFilterDef(notificationSource),
    doneFilterDef(notificationSource),
    ...ENTITY_TYPE_FILTERS,
    channelsFilter,
    filesAndFolderFilter,
    projectFilter,
    activeAgentFilter,
    emailDraftsFilter,
    noDraftsFilter,
    hasCalendarInviteFilter,
    hasAttachmentFilter,
    attachmentPdfFilter,
    attachmentImageFilter,
    attachmentDocumentFilter,
    sharedEntityFilter(getUserID),
    ownedAgentFilterDef(getUserID),
    sharedAgentFilterDef(getUserID),
    assignedToFilter(getUserID),
    notTaskFilter,
    documentOrFileFilter,
    activeTaskFilter,
    ...TASK_STATUS_FILTERS,
    ...TASK_PRIORITY_FILTERS,
    ...DOCUMENT_CONTEXTUAL_FILTERS,
    ...FILE_TYPE_FILTERS,
  ] as const;
};

export const SOUP_FILTER_GROUPS: FilterGroupConfig[] = [
  { id: 'focus', allowMultiple: false },
  { id: 'entity-type', allowMultiple: true },
];

type SoupFilter = ReturnType<typeof createSoupFilters>[number];
export type FilterID = SoupFilter['id'];
