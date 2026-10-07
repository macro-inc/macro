import {
  moveTaskAssignees,
  type TaskBoardColumn,
  type TaskBoardGrouping,
  type TaskBoardMove,
  type TaskBoardTask,
  taskBoardGroupKeys,
} from './task-board';

export type TaskBoardPlacement = {
  task: TaskBoardTask;
  /** Membership before the move, including groups outside loaded pages. */
  previousGroupKeys: readonly string[];
  grouping: TaskBoardGrouping;
  scope: string;
  confirmed: boolean;
};

export function movedTask(
  task: TaskBoardTask,
  grouping: TaskBoardGrouping,
  move: TaskBoardMove
): TaskBoardTask {
  switch (grouping) {
    case 'status':
      return { ...task, statusId: move.toLane || undefined };
    case 'priority':
      return { ...task, priorityId: move.toLane || undefined };
    case 'project':
      return { ...task, projectIds: move.toLane ? [move.toLane] : [] };
    case 'assignee':
      return {
        ...task,
        assigneeIds: moveTaskAssignees(
          task.assigneeIds,
          move.fromLane,
          move.toLane
        ),
      };
  }
}

/** Compare loaded memberships only; never invent or load a hidden destination. */
export function placementMatches(
  columns: readonly TaskBoardColumn[],
  placement: TaskBoardPlacement
): boolean {
  const keys = taskBoardGroupKeys(placement.task, placement.grouping);
  return columns.every(
    (column) =>
      column.tasks.some((task) => task.id === placement.task.id) ===
      keys.includes(column.id)
  );
}

/** Keep server ordering intact; insert only the moved card using the host's rank. */
export function projectTaskBoardPlacements(
  columns: readonly TaskBoardColumn[],
  placements: readonly TaskBoardPlacement[],
  compare?: (left: string, right: string) => number
): readonly TaskBoardColumn[] {
  if (placements.length === 0) {
    return columns;
  }

  return columns.map((column) => {
    let tasks = [...column.tasks];
    let count = column.count;

    for (const placement of placements) {
      const task = placement.task;
      const index = tasks.findIndex((item) => item.id === task.id);
      const belongs = taskBoardGroupKeys(task, placement.grouping).includes(
        column.id
      );

      if (index >= 0 && belongs) {
        tasks[index] = task;
        continue;
      }

      if (index >= 0) {
        tasks.splice(index, 1);
        count = count === undefined ? undefined : Math.max(0, count - 1);
        continue;
      }

      if (!belongs) {
        continue;
      }

      const before = compare
        ? tasks.findIndex((item) => compare(task.id, item.id) < 0)
        : -1;
      tasks.splice(before < 0 ? tasks.length : before, 0, task);
      if (!placement.previousGroupKeys.includes(column.id)) {
        count = count === undefined ? undefined : count + 1;
      }
    }

    return { ...column, tasks, count };
  });
}

export type TaskBoardLocalPosition = Pick<
  TaskBoardMove,
  'id' | 'toLane' | 'beforeId'
>;

/** Apply session-only pointer placements without changing membership or counts. */
export function projectTaskBoardLocalPositions(
  columns: readonly TaskBoardColumn[],
  positions: readonly TaskBoardLocalPosition[]
): readonly TaskBoardColumn[] {
  if (positions.length === 0) {
    return columns;
  }

  return columns.map((column) => {
    const tasks = [...column.tasks];

    for (const position of positions) {
      if (position.toLane !== column.id) {
        continue;
      }

      const index = tasks.findIndex((task) => task.id === position.id);

      if (index < 0 || position.beforeId === position.id) {
        continue;
      }

      const [task] = tasks.splice(index, 1);
      const before = tasks.findIndex((item) => item.id === position.beforeId);
      tasks.splice(before < 0 ? tasks.length : before, 0, task);
    }

    return { ...column, tasks };
  });
}
