import type { SortConfig } from '@app/component/next-soup/create-soup-state';
import type { SoupEntity } from '@app/component/next-soup/soup-view/soup-view-context';
import type {
  EntityData,
  TaskEntityWithProperties,
  WithNotification,
} from '@entity';
import {
  getTaskPriorityOptionId,
  getTaskStatusOptionId,
} from '@entity/utils/task-properties';
import { compareDateDesc } from '@core/util/date';
import { PROPERTY_OPTION_IDS } from '@core/component/Properties/constants';
import type { JSX } from 'solid-js';
import ClockIcon from '@icon/regular/clock.svg';
import ArrowClockwiseIcon from '@icon/regular/arrow-clockwise.svg';
import EyeIcon from '@icon/regular/eye.svg';
import ChartLineUpIcon from '@icon/regular/chart-line-up.svg';
import FlagIcon from '@icon/regular/flag.svg';
import ListChecksIcon from '@icon/regular/list-checks.svg';

export type SystemSortOption =
  | 'updated_at'
  | 'created_at'
  | 'viewed_at'
  | 'frecency'
  | 'priority'
  | 'status';

export interface SortOption {
  value: SystemSortOption;
  label: string;
  icon?: () => JSX.Element;
}

export function sortByNotifiedAt<T extends WithNotification<EntityData>>(
  a: T,
  b: T
) {
  const aNotification = a.notifications?.()[0];
  const bNotification = b.notifications?.()[0];

  if (aNotification && bNotification) {
    return compareDateDesc(aNotification.created_at, bNotification.created_at);
  } else if (aNotification) {
    return -1;
  } else if (bNotification) {
    return 1;
  }

  return sortByUpdatedAt(a, b);
}

export function sortByCreatedAt<T extends EntityData>(a: T, b: T): number {
  return compareDateDesc(a.createdAt, b.createdAt);
}

export function sortByUpdatedAt<T extends EntityData>(a: T, b: T) {
  return compareDateDesc(a.updatedAt, b.updatedAt);
}

export function sortByViewedAt<T extends EntityData>(a: T, b: T) {
  return compareDateDesc(a.viewedAt, b.viewedAt);
}

export function sortByFrecencyScore<T extends EntityData>(a: T, b: T): number {
  return (b.frecencyScore ?? 0) - (a.frecencyScore ?? 0);
}

/**
 * Priority sort order: Urgent (highest) -> High -> Medium -> Low -> No priority (lowest)
 */
const PRIORITY_ORDER: Record<string, number> = {
  [PROPERTY_OPTION_IDS.PRIORITY.URGENT]: 0,
  [PROPERTY_OPTION_IDS.PRIORITY.HIGH]: 1,
  [PROPERTY_OPTION_IDS.PRIORITY.MEDIUM]: 2,
  [PROPERTY_OPTION_IDS.PRIORITY.LOW]: 3,
};
const NO_PRIORITY_ORDER = 4;

const getPriorityOrder = (priority: string | undefined) => {
  if (!priority) return NO_PRIORITY_ORDER;

  return PRIORITY_ORDER[priority] ?? NO_PRIORITY_ORDER;
};

/**
 * Status sort order: Not Started -> In Progress -> In Review -> Completed -> Canceled
 */
const STATUS_ORDER: Record<string, number> = {
  [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED]: 0,
  [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS]: 1,
  [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW]: 2,
  [PROPERTY_OPTION_IDS.STATUS.COMPLETED]: 3,
  [PROPERTY_OPTION_IDS.STATUS.CANCELED]: 4,
};

const NO_STATUS_ORDER = 5;

const getStatusOrder = (status: string | undefined) => {
  if (!status) return NO_STATUS_ORDER;

  return STATUS_ORDER[status] ?? NO_STATUS_ORDER;
};

/**
 * Sort tasks by priority (Urgent first, no priority last).
 * Non-task entities are sorted to the end.
 */
export function sortByPriority<T extends EntityData>(a: T, b: T): number {
  // Cast to TaskEntityWithProperties - the getter safely handles missing properties
  const aPriority = getTaskPriorityOptionId(a as TaskEntityWithProperties);
  const bPriority = getTaskPriorityOptionId(b as TaskEntityWithProperties);

  const aOrder = getPriorityOrder(aPriority);
  const bOrder = getPriorityOrder(bPriority);

  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  // Fall back to updated_at for same priority
  return sortByUpdatedAt(a, b);
}

/**
 * Sort tasks by status (Not Started first, Canceled last).
 * Non-task entities are sorted to the end.
 */
export function sortByStatus<T extends EntityData>(a: T, b: T): number {
  // Cast to TaskEntityWithProperties - the getter safely handles missing properties
  const aStatus = getTaskStatusOptionId(a as TaskEntityWithProperties);
  const bStatus = getTaskStatusOptionId(b as TaskEntityWithProperties);

  const aOrder = getStatusOrder(aStatus);
  const bOrder = getStatusOrder(bStatus);

  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  // Fall back to updated_at for same status
  return sortByUpdatedAt(a, b);
}

export const SORT_CONFIGS = {
  updated_at: {
    id: 'updated_at',
    fn: sortByUpdatedAt,
  },
  created_at: {
    id: 'created_at',
    fn: sortByCreatedAt,
  },
  viewed_at: {
    id: 'viewed_at',
    fn: sortByViewedAt,
  },
  frecency: {
    id: 'frecency',
    fn: sortByFrecencyScore,
  },
  priority: {
    id: 'priority',
    fn: sortByPriority,
  },
  status: {
    id: 'status',
    fn: sortByStatus,
  },
} satisfies Record<string, SortConfig<SoupEntity>>;

export const SORT_OPTIONS: SortOption[] = [
  {
    value: 'viewed_at',
    label: 'Last viewed',
    icon: () => <EyeIcon class="size-3.5" />,
  },
  {
    value: 'updated_at',
    label: 'Last updated',
    icon: () => <ArrowClockwiseIcon class="size-3.5" />,
  },
  {
    value: 'created_at',
    label: 'Date created',
    icon: () => <ClockIcon class="size-3.5" />,
  },
  {
    value: 'frecency',
    label: 'Frecency',
    icon: () => <ChartLineUpIcon class="size-3.5" />,
  },
];

export const TASK_SORT_OPTIONS: SortOption[] = [
  ...SORT_OPTIONS,
  {
    value: 'priority',
    label: 'Priority',
    icon: () => <FlagIcon class="size-3.5" />,
  },
  {
    value: 'status',
    label: 'Status',
    icon: () => <ListChecksIcon class="size-3.5" />,
  },
];
