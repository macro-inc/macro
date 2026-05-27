import {
  getTaskAssigneeIds,
  isTaskEntity,
  type TaskEntityWithProperties,
} from '@entity';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  hasNoPriority,
  isCanceled,
  isCompleted,
  isHighPriority,
  isInProgress,
  isInReview,
  isLowPriority,
  isMediumPriority,
  isNotStarted,
  isOpen,
  isUrgentPriority,
  taskAssignedToUserFilter as taskAssignedToUserPredicate,
  taskFilter as taskPredicate,
} from '../predicates';
import {
  config,
  isTask,
  NO_ASSIGNEE,
  type Predicate,
  propFilter,
} from './base';

const statusFilter = <TId extends string>(
  id: TId,
  status: string,
  predicate: Predicate
) =>
  config({
    id,
    predicate,
    query: {
      include: {
        properties: [propFilter(SYSTEM_PROPERTY_IDS.STATUS, 'select', status)],
      },
    },
  });

const priorityFilter = <TId extends string>(
  id: TId,
  priority: string,
  predicate: Predicate
) =>
  config({
    id,
    predicate,
    query: {
      include: {
        properties: [
          propFilter(SYSTEM_PROPERTY_IDS.PRIORITY, 'select', priority),
        ],
      },
    },
  });

const taskNotStartedFilter = statusFilter(
  'task-not-started',
  PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
  isNotStarted
);

const taskInProgressFilter = statusFilter(
  'task-in-progress',
  PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
  isInProgress
);

const taskInReviewFilter = statusFilter(
  'task-in-review',
  PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
  isInReview
);

const taskCompletedFilter = statusFilter(
  'task-completed',
  PROPERTY_OPTION_IDS.STATUS.COMPLETED,
  isCompleted
);

const taskCanceledFilter = statusFilter(
  'task-canceled',
  PROPERTY_OPTION_IDS.STATUS.CANCELED,
  isCanceled
);

export const activeTaskFilter = config({
  id: 'active-task',
  predicate: (e) => taskPredicate(e) && isOpen(e),
  query: {
    include: { subType: ['task'] },
    exclude: {
      properties: [
        propFilter(
          SYSTEM_PROPERTY_IDS.STATUS,
          'select',
          PROPERTY_OPTION_IDS.STATUS.COMPLETED
        ),
        propFilter(
          SYSTEM_PROPERTY_IDS.STATUS,
          'select',
          PROPERTY_OPTION_IDS.STATUS.CANCELED
        ),
      ],
    },
  },
});

export const TASK_STATUS_FILTERS = [
  taskNotStartedFilter,
  taskInProgressFilter,
  taskInReviewFilter,
  taskCompletedFilter,
  taskCanceledFilter,
] as const;

const taskUrgentFilter = priorityFilter(
  'task-urgent',
  PROPERTY_OPTION_IDS.PRIORITY.URGENT,
  isUrgentPriority
);

const taskHighPriorityFilter = priorityFilter(
  'task-high-priority',
  PROPERTY_OPTION_IDS.PRIORITY.HIGH,
  isHighPriority
);

const taskMediumPriorityFilter = priorityFilter(
  'task-medium-priority',
  PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
  isMediumPriority
);

const taskLowPriorityFilter = priorityFilter(
  'task-low-priority',
  PROPERTY_OPTION_IDS.PRIORITY.LOW,
  isLowPriority
);

const taskNoPriorityFilter = config({
  id: 'task-no-priority',
  predicate: hasNoPriority,
  query: {
    ...isTask,
    exclude: {
      properties: [
        propFilter(
          SYSTEM_PROPERTY_IDS.PRIORITY,
          'select',
          PROPERTY_OPTION_IDS.PRIORITY.URGENT
        ),
        propFilter(
          SYSTEM_PROPERTY_IDS.PRIORITY,
          'select',
          PROPERTY_OPTION_IDS.PRIORITY.HIGH
        ),
        propFilter(
          SYSTEM_PROPERTY_IDS.PRIORITY,
          'select',
          PROPERTY_OPTION_IDS.PRIORITY.MEDIUM
        ),
        propFilter(
          SYSTEM_PROPERTY_IDS.PRIORITY,
          'select',
          PROPERTY_OPTION_IDS.PRIORITY.LOW
        ),
      ],
    },
  },
});

export const TASK_PRIORITY_FILTERS = [
  taskUrgentFilter,
  taskHighPriorityFilter,
  taskMediumPriorityFilter,
  taskLowPriorityFilter,
  taskNoPriorityFilter,
] as const;

export const assignedToMeFilter = config({
  id: 'assigned-to',
  predicate: (e, ctx) => taskAssignedToUserPredicate(() => ctx.userId)(e),
  query: (ctx) => ({
    include: {
      properties: [
        propFilter(SYSTEM_PROPERTY_IDS.ASSIGNEES, 'entity', ctx.userId ?? ''),
      ],
    },
  }),
});

export const assigneeFilter = config({
  id: 'assignee',
  predicate: (e, ctx) => {
    if (!ctx.assignees?.length || !isTaskEntity(e)) return true;
    const ids = getTaskAssigneeIds(e as unknown as TaskEntityWithProperties);
    return ctx.assignees.some((id: string) =>
      id === NO_ASSIGNEE ? ids.length === 0 : ids.includes(id)
    );
  },
  query: (ctx) => {
    if (!ctx.assignees?.length) return {};
    const userIds = ctx.assignees.filter((id: string) => id !== NO_ASSIGNEE);
    if (userIds.length === 0) return isTask;
    return {
      ...isTask,
      include: {
        properties: userIds.map((id: string) =>
          propFilter(SYSTEM_PROPERTY_IDS.ASSIGNEES, 'entity', id)
        ),
      },
    };
  },
});
