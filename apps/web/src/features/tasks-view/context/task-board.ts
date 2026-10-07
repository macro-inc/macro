import type { Accessor } from 'solid-js';
import type {
  TaskBoardColumn,
  TaskBoardGrouping,
  TaskBoardMove,
  TaskBoardTask,
} from '../core/task-board';

export type TaskBoardActions = {
  canEditTask(id: string): boolean;
  canMoveTo(grouping: TaskBoardGrouping, id: string): boolean;
  save(move: TaskBoardMove, grouping: TaskBoardGrouping): Promise<void>;
};

export type TaskBoardData = {
  columns: Accessor<readonly TaskBoardColumn[]>;
  /** Known excluded columns; dynamic groupings can contain additional unloaded columns. */
  hiddenColumnCount: Accessor<number>;
  task(id: string): TaskBoardTask | undefined;
  compareTasks?: (left: string, right: string) => number;
  actions: TaskBoardActions;
  statusLabel(id: string | undefined): string | undefined;
  priorityLabel(id: string | undefined): string | undefined;
  definitionError: Accessor<boolean>;
  retryDefinitions(): Promise<void>;
};
