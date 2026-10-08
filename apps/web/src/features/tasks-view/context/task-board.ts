import type { Property, PropertyApiValues } from '@property/types';
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
  /** Instantiate under the mounted column label's owner. */
  createAssigneeName(id: Accessor<string>): Accessor<string | undefined>;
  compareTasks?: (left: string, right: string) => number;
  actions: TaskBoardActions;
  property(taskId: string, propertyId: string): Property | undefined;
  canEditProperty(taskId: string, propertyId: string): boolean;
  saveProperty(
    taskId: string,
    property: Property,
    values: PropertyApiValues
  ): Promise<void>;
  definitionError: Accessor<boolean>;
  retryDefinitions(): Promise<void>;
};
