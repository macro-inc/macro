import {
  getTaskAssigneeIds,
  getTaskStatusOptionId,
} from '@entity/utils/task-properties';
import type { TaskEntityWithProperties } from '@entity/types/entity';

export const NO_ASSIGNEE = 'NO_ASSIGNEE';

type TaskSubFilters = {
  statusFilter?: string;
  assigneeFilter?: string;
};

export const matchesTaskSubFilters = (
  taskEntity: TaskEntityWithProperties,
  filters: TaskSubFilters
): boolean => {
  const { statusFilter, assigneeFilter } = filters;

  if (!statusFilter && !assigneeFilter) {
    return true;
  }

  // Search-service task entities can be returned without properties.
  // Keep them until property data is available so valid search hits aren't dropped.
  if (!taskEntity.properties) {
    return true;
  }

  if (statusFilter && getTaskStatusOptionId(taskEntity) !== statusFilter) {
    return false;
  }

  if (assigneeFilter) {
    const assigneeIds = getTaskAssigneeIds(taskEntity);
    if (assigneeFilter === NO_ASSIGNEE) {
      if (assigneeIds.length > 0) return false;
    } else if (!assigneeIds.includes(assigneeFilter)) {
      return false;
    }
  }

  return true;
};
