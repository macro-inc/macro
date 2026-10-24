import { match } from 'ts-pattern';
import type { TaskGroupBy } from '../types';
import type { TaskDueDateBucket } from './task-due-date';

export type TaskBoardGrouping =
  | 'status'
  | 'priority'
  | 'assignee'
  | 'project'
  | 'due_date';

export const TASK_BOARD_GROUP_OPTIONS: {
  id: TaskBoardGrouping;
  label: string;
}[] = [
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priority' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'project', label: 'Project' },
  { id: 'due_date', label: 'Due date' },
];

/** List-only groupings display Status columns in the board layout. */
export function toTaskBoardGrouping(groupBy: TaskGroupBy): TaskBoardGrouping {
  return match(groupBy)
    .with('none', 'date', () => 'status' as const)
    .with(
      'status',
      'priority',
      'assignee',
      'project',
      'due_date',
      (grouping) => grouping
    )
    .exhaustive();
}

export type TaskBoardTask = {
  id: string;
  name: string;
  statusId?: string;
  priorityId?: string;
  assigneeIds: readonly string[];
  projectIds: readonly string[];
  dueDate?: string;
  deadline?: TaskDueDateBucket;
};

export type TaskBoardColumn = {
  id: string;
  label: string;
  tasks: readonly TaskBoardTask[];
  /** Omitted for search results, whose complete count is not known. */
  count?: number;
  hasMore: boolean;
  loadingMore: boolean;
};

export type TaskBoardMove = {
  id: string;
  fromLane: string;
  toLane: string;
  /** Resolved UTC instant, or null to clear; supplied before a deadline move saves. */
  dueDate?: string | null;
};

export function taskBoardGroupKeys(
  task: TaskBoardTask,
  grouping: TaskBoardGrouping
): readonly string[] {
  const values = match(grouping)
    .with('status', () => (task.statusId ? [task.statusId] : []))
    .with('priority', () => (task.priorityId ? [task.priorityId] : []))
    .with('assignee', () => task.assigneeIds)
    .with('project', () => task.projectIds)
    .with('due_date', () => [task.deadline ?? 'no_due_date'])
    .exhaustive();

  return values.length ? values : [''];
}

/** An unassigned destination explicitly clears all assignments. */
export function moveTaskAssignees(
  ids: readonly string[],
  from: string,
  to: string
): string[] {
  if (!to) {
    return [];
  }

  const remaining = ids.filter((id) => id !== from);

  return [...remaining, to].filter(
    (id, index, values) => values.indexOf(id) === index
  );
}

export function isTaskBoardMove(
  task: TaskBoardTask | undefined,
  grouping: TaskBoardGrouping,
  move: TaskBoardMove
): task is TaskBoardTask {
  if (!task || task.id !== move.id) {
    return false;
  }

  if (move.fromLane === move.toLane) {
    return false;
  }

  return taskBoardGroupKeys(task, grouping).includes(move.fromLane);
}
