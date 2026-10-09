import type { FacetSelection } from '@app/features/soup';
import type { TaskEntityWithProperties } from '@entity/types/entity';
import {
  getTaskPriorityOptionId,
  getTaskReferencedEntityIds,
  getTaskStatusOptionId,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
} from '@entity/utils/task-properties';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { PropertyApiValues } from '@property/types';
import {
  moveTaskAssignees,
  type TaskBoardColumn,
  type TaskBoardGrouping,
  type TaskBoardMove,
  type TaskBoardTask,
  taskBoardGroupKeys,
} from '../core/task-board';
import {
  EMPTY_TASK_FACET_CONTEXT,
  getTaskFacetOption,
} from '../filters/task-facets';
import type { TasksDataSourceItem } from './use-tasks-query';

const BOARD_PROPERTY_IDS = {
  status: SYSTEM_PROPERTY_IDS.STATUS,
  priority: SYSTEM_PROPERTY_IDS.PRIORITY,
  assignee: SYSTEM_PROPERTY_IDS.ASSIGNEES,
  project: SYSTEM_PROPERTY_IDS.PROJECT,
};

export function taskBoardPropertyId(grouping: TaskBoardGrouping): string {
  return BOARD_PROPERTY_IDS[grouping];
}

export function toBoardTask(task: TaskEntityWithProperties): TaskBoardTask {
  return {
    id: task.id,
    name: task.name,
    statusId: getTaskStatusOptionId(task),
    priorityId: getTaskPriorityOptionId(task),
    // Include both people and agent assignees. Their original reference types are retained on writes.
    assigneeIds: getTaskReferencedEntityIds(
      task,
      SYSTEM_PROPERTY_IDS.ASSIGNEES
    ),
    projectIds: getTaskReferencedEntityIds(task, SYSTEM_PROPERTY_IDS.PROJECT),
  };
}

export function taskBoardFacetId(grouping: TaskBoardGrouping): string {
  return grouping === 'assignee' ? 'assignees' : grouping;
}

function allowedBoardColumns(
  grouping: TaskBoardGrouping,
  facets: FacetSelection
) {
  const facetId = taskBoardFacetId(grouping);
  const selected = facets[facetId] ?? [];
  const columnIds = selected.flatMap((id) => {
    if (id === '' || grouping === 'project') {
      return [id];
    }

    const option = getTaskFacetOption(facetId, id, EMPTY_TASK_FACET_CONTEXT);

    if (!option) {
      return [];
    }

    if (grouping === 'assignee') {
      return [option.propertyEntityId ?? id];
    }

    return option.propertyOptionId ? [option.propertyOptionId] : [];
  });

  return new Set(columnIds);
}

export function filterTaskBoardColumns(
  columns: readonly TaskBoardColumn[],
  grouping: TaskBoardGrouping,
  facets: FacetSelection
): TaskBoardColumn[] {
  const allowedColumnIds = allowedBoardColumns(grouping, facets);

  return columns.filter((column) => {
    return allowedColumnIds.size === 0 || allowedColumnIds.has(column.id);
  });
}

/** The query owns pagination and membership; the board never regroups a partial normal page. */
export function taskBoardColumns(
  rows: readonly TasksDataSourceItem[],
  grouping: TaskBoardGrouping,
  searching: boolean
): TaskBoardColumn[] {
  const columns = new Map<
    string,
    Omit<TaskBoardColumn, 'tasks'> & { tasks: TaskBoardTask[] }
  >();

  const addColumn = (id: string, label: string) => {
    let column = columns.get(id);

    if (column) {
      return column;
    }

    column = {
      id,
      label,
      tasks: [],
      count: searching ? undefined : 0,
      hasMore: false,
      loadingMore: false,
    };
    columns.set(id, column);

    return column;
  };

  const options = {
    status: TASK_STATUS_OPTIONS,
    priority: TASK_PRIORITY_OPTIONS,
    assignee: [],
    project: [],
  }[grouping];

  for (const option of options) {
    addColumn(option.value, option.label);
  }

  addColumn(
    '',
    {
      status: 'No status',
      priority: 'No priority',
      assignee: 'Unassigned',
      project: 'No project',
    }[grouping]
  );

  for (const row of rows) {
    if (row.kind !== 'group-header') {
      continue;
    }

    const column = addColumn(row.groupId, row.label);

    column.count = row.count;
  }

  const seen = new Map<string, Set<string>>();

  for (const row of rows) {
    if (row.kind === 'load-more' && row.groupId !== undefined) {
      const column = columns.get(row.groupId);

      if (column) {
        column.hasMore = true;
        column.loadingMore = !!row.isLoading;
      }
    }

    if (row.kind !== 'entity') {
      continue;
    }

    const task = toBoardTask(row.entity);
    const keys =
      searching || row.groupId === undefined
        ? taskBoardGroupKeys(task, grouping)
        : [row.groupId];

    for (const key of keys) {
      const column = addColumn(key, key || 'Not set');

      const ids = seen.get(key) ?? new Set<string>();
      seen.set(key, ids);

      if (ids.has(task.id)) {
        continue;
      }

      ids.add(task.id);
      column.tasks.push(task);
    }
  }

  return [...columns.values()].map((column) => ({
    ...column,
    count:
      column.count === undefined
        ? undefined
        : Math.max(column.count, column.tasks.length),
  }));
}

/** Preserve untouched assignees and their wire reference types. */
export function taskBoardMoveValue(
  entity: TaskEntityWithProperties,
  grouping: TaskBoardGrouping,
  move: TaskBoardMove
): PropertyApiValues {
  if (grouping === 'status' || grouping === 'priority') {
    return {
      valueType: 'SELECT_STRING',
      values: move.toLane ? [move.toLane] : null,
    };
  }

  if (grouping === 'project') {
    return {
      valueType: 'ENTITY',
      refs: move.toLane
        ? [{ entity_id: move.toLane, entity_type: 'INITIATIVE' }]
        : null,
    };
  }

  const property = entity.properties?.find(
    (property) => property.definition.id === SYSTEM_PROPERTY_IDS.ASSIGNEES
  );
  const refs =
    property?.value?.type === 'EntityReference' &&
    Array.isArray(property.value.value)
      ? property.value.value
      : [];
  const nextIds = moveTaskAssignees(
    toBoardTask(entity).assigneeIds,
    move.fromLane,
    move.toLane
  );

  if (nextIds.length === 0) {
    return { valueType: 'ENTITY', refs: null };
  }

  const nextRefs = nextIds.map((id) => {
    const existing = refs.find((ref) => ref.entity_id === id);

    return existing ?? { entity_id: id, entity_type: 'USER' as const };
  });

  return { valueType: 'ENTITY', refs: nextRefs };
}
