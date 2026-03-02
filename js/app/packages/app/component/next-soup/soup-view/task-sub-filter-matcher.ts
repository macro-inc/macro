import {
  getTaskAssigneeIds,
  getTaskStatusOptionId,
} from '@entity/utils/task-properties';
import type { TaskEntityWithProperties } from '@entity/types/entity';

type TaskSubFilters = {
  statusFilter?: string[];
  assigneeFilter?: string[];
};

export const matchesTaskSubFilters = (
  taskEntity: TaskEntityWithProperties,
  filters: TaskSubFilters
): boolean => {
  const { statusFilter, assigneeFilter } = filters;

  const hasStatusFilter = statusFilter && statusFilter.length > 0;
  const hasAssigneeFilter = assigneeFilter && assigneeFilter.length > 0;

  if (!hasStatusFilter && !hasAssigneeFilter) {
    return true;
  }

  // Search-service task entities can be returned without properties.
  // Keep them until property data is available so valid search hits aren't dropped.
  if (!taskEntity.properties) {
    return true;
  }

  if (hasStatusFilter) {
    const taskStatus = getTaskStatusOptionId(taskEntity);
    if (!taskStatus || !statusFilter.includes(taskStatus)) {
      return false;
    }
  }

  if (hasAssigneeFilter) {
    const taskAssignees = getTaskAssigneeIds(taskEntity);
    // Match if any of the task's assignees are in the filter
    if (!taskAssignees.some((id) => assigneeFilter.includes(id))) {
      return false;
    }
  }

  return true;
};
