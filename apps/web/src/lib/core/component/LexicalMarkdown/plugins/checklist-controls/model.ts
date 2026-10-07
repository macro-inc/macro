/**
 * @file Pure data model for task-list controls: the per-item metadata
 * collected from a check list, the effective task fields after real task
 * properties are merged in, and the planner that turns the persisted filters
 * into row styling. No Lexical or DOM access here so the logic stays
 * unit-testable.
 */

import type { TaskListViewSettings } from '@macro-inc/lexical-core';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { differenceInCalendarDays } from 'date-fns';
import type { NodeKey } from 'lexical';

export type TaskStatusBucket =
  | 'not-started'
  | 'in-progress'
  | 'in-review'
  | 'done'
  | 'canceled';
export type TaskPriorityBucket = 'urgent' | 'high' | 'medium' | 'low';
export type TaskDueBucket = 'overdue' | 'today' | 'week' | 'later';

export type ChecklistAssignee = { id: string; name: string };

/** Raw per-item facts read from the editor state. */
export type ChecklistItemMeta = {
  key: NodeKey;
  /** Nested sub-list wrappers before the item that travel with it. */
  leadingKeys: NodeKey[];
  /** Nested sub-list wrappers after the item that travel with it. */
  attachedKeys: NodeKey[];
  checked: boolean;
  text: string;
  /** From inline user mentions. */
  mentionAssignees: ChecklistAssignee[];
  /** ISO date string of the first date mention, if any. */
  mentionDue: string | null;
  /** From trailing `!` markers: `!` medium, `!!` high, `!!!` urgent. */
  markerPriority: TaskPriorityBucket | null;
  /** The real task this item points at, when it is a task mention. */
  taskId: string | null;
};

export type ChecklistMeta = {
  listKey: NodeKey;
  items: ChecklistItemMeta[];
  settings: TaskListViewSettings | null;
};

/** Task properties resolved for a task mention. */
export type TaskInfo = {
  statusOptionId: string | null;
  priorityOptionId: string | null;
  assigneeIds: string[];
  /** ISO date string. */
  due: string | null;
};

/** An item with its task data merged in — what the filters see. */
export type EffectiveItem = {
  key: NodeKey;
  leadingKeys: NodeKey[];
  attachedKeys: NodeKey[];
  text: string;
  status: TaskStatusBucket;
  priority: TaskPriorityBucket | null;
  assignees: ChecklistAssignee[];
  due: string | null;
};

export type TaskListFilters = {
  status: string[];
  priority: string[];
  assignees: string[];
  due: string[];
};

export type NormalizedSettings = {
  filters: TaskListFilters;
};

export function normalizeSettings(
  settings: TaskListViewSettings | null | undefined
): NormalizedSettings {
  const filters = settings?.filters;
  return {
    filters: {
      status: filters?.status ?? [],
      priority: filters?.priority ?? [],
      assignees: filters?.assignees ?? [],
      due: filters?.due ?? [],
    },
  };
}

const TRAILING_PRIORITY = /(!{1,3})\s*$/;

export function parseMarkerPriority(text: string): TaskPriorityBucket | null {
  const match = TRAILING_PRIORITY.exec(text);
  if (!match) return null;
  if (match[1].length >= 3) return 'urgent';
  return match[1].length === 2 ? 'high' : 'medium';
}

const STATUS_BY_OPTION_ID: Record<string, TaskStatusBucket> = {
  [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED]: 'not-started',
  [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS]: 'in-progress',
  [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW]: 'in-review',
  [PROPERTY_OPTION_IDS.STATUS.COMPLETED]: 'done',
  [PROPERTY_OPTION_IDS.STATUS.CANCELED]: 'canceled',
};

const PRIORITY_BY_OPTION_ID: Record<string, TaskPriorityBucket> = {
  [PROPERTY_OPTION_IDS.PRIORITY.URGENT]: 'urgent',
  [PROPERTY_OPTION_IDS.PRIORITY.HIGH]: 'high',
  [PROPERTY_OPTION_IDS.PRIORITY.MEDIUM]: 'medium',
  [PROPERTY_OPTION_IDS.PRIORITY.LOW]: 'low',
};

export const STATUS_OPTION_ID: Record<TaskStatusBucket, string> = {
  'not-started': PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
  'in-progress': PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
  'in-review': PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
  done: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
  canceled: PROPERTY_OPTION_IDS.STATUS.CANCELED,
};

export const PRIORITY_OPTION_ID: Record<TaskPriorityBucket, string> = {
  urgent: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
  high: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
  medium: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
  low: PROPERTY_OPTION_IDS.PRIORITY.LOW,
};

export const STATUS_LABELS: Record<TaskStatusBucket, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  'in-review': 'In review',
  done: 'Done',
  canceled: 'Canceled',
};

export const PRIORITY_LABELS: Record<TaskPriorityBucket | 'none', string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
};

export const DUE_LABELS: Record<TaskDueBucket | 'none', string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
  none: 'No date',
};

export const STATUS_ORDER: TaskStatusBucket[] = [
  'not-started',
  'in-progress',
  'in-review',
  'done',
  'canceled',
];
export const PRIORITY_ORDER: Array<TaskPriorityBucket | 'none'> = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
];
export const DUE_ORDER: Array<TaskDueBucket | 'none'> = [
  'overdue',
  'today',
  'week',
  'later',
  'none',
];

/**
 * Merge an item's raw facts with its resolved task properties. Task data wins;
 * inline mentions and `!` markers back-fill plain checkbox items.
 */
export function effectiveItem(
  item: ChecklistItemMeta,
  task: TaskInfo | undefined,
  resolveName: (userId: string) => string
): EffectiveItem {
  const taskStatus = task?.statusOptionId
    ? STATUS_BY_OPTION_ID[task.statusOptionId]
    : undefined;
  const taskPriority = task?.priorityOptionId
    ? PRIORITY_BY_OPTION_ID[task.priorityOptionId]
    : undefined;
  const assignees =
    task && task.assigneeIds.length > 0
      ? task.assigneeIds.map((id) => ({ id, name: resolveName(id) }))
      : item.mentionAssignees;
  return {
    key: item.key,
    leadingKeys: item.leadingKeys,
    attachedKeys: item.attachedKeys,
    text: item.text,
    status: taskStatus ?? (item.checked ? 'done' : 'not-started'),
    priority: taskPriority ?? item.markerPriority,
    assignees,
    due: task?.due ?? item.mentionDue,
  };
}

export function dueBucket(
  due: string | null,
  now: Date
): TaskDueBucket | 'none' {
  if (!due) return 'none';
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return 'none';
  const days = differenceInCalendarDays(date, now);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= 7 ? 'week' : 'later';
}

export function countActiveFilters(filters: TaskListFilters): number {
  return (
    filters.status.length +
    filters.priority.length +
    filters.assignees.length +
    filters.due.length
  );
}

export function itemMatchesFilters(
  item: EffectiveItem,
  filters: TaskListFilters,
  now: Date
): boolean {
  if (filters.status.length > 0 && !filters.status.includes(item.status)) {
    return false;
  }
  if (
    filters.priority.length > 0 &&
    !filters.priority.includes(item.priority ?? 'none')
  ) {
    return false;
  }
  if (filters.assignees.length > 0) {
    const matches =
      item.assignees.length === 0
        ? filters.assignees.includes('unassigned')
        : item.assignees.some((a) => filters.assignees.includes(a.id));
    if (!matches) return false;
  }
  if (
    filters.due.length > 0 &&
    !filters.due.includes(dueBucket(item.due, now))
  ) {
    return false;
  }
  return true;
}

export type ChecklistRowPlan = {
  key: NodeKey;
  dimmed: boolean;
};

export type ChecklistPlan = {
  rows: ChecklistRowPlan[];
  /** Any filter engaged — keeps the control visible without hover. */
  active: boolean;
  progress: { done: number; total: number };
};

function progressOf(items: EffectiveItem[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const item of items) {
    if (item.text === '') continue;
    total += 1;
    if (item.status === 'done' || item.status === 'canceled') done += 1;
  }
  return { done, total };
}

export function planChecklist(
  items: EffectiveItem[],
  settings: NormalizedSettings,
  now: Date
): ChecklistPlan {
  const filterActive = countActiveFilters(settings.filters) > 0;
  const rows: ChecklistRowPlan[] = [];

  for (const item of items) {
    const dimmed =
      filterActive && !itemMatchesFilters(item, settings.filters, now);
    for (const key of [...item.leadingKeys, item.key, ...item.attachedKeys]) {
      rows.push({ key, dimmed });
    }
  }

  return { rows, active: filterActive, progress: progressOf(items) };
}
