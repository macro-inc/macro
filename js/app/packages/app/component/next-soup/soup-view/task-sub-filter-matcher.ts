import { getTaskAssigneeIds } from '@entity/utils/task-properties';
import type { TaskEntityWithProperties } from '@entity/types/entity';

export const NO_ASSIGNEE = 'NO_ASSIGNEE';

type TaskSubFilters = {
  assigneeFilter?: string[];
};

export const matchesTaskSubFilters = (
  taskEntity: TaskEntityWithProperties,
  filters: TaskSubFilters
): boolean => {
  const { assigneeFilter } = filters;

  const hasAssigneeFilter = assigneeFilter && assigneeFilter.length > 0;

  if (!hasAssigneeFilter) {
    return true;
  }

  // Search-service task entities can be returned without properties.
  // Keep them until property data is available so valid search hits aren't dropped.
  if (!taskEntity.properties) {
    return true;
  }

  if (hasAssigneeFilter) {
    const taskAssignees = getTaskAssigneeIds(taskEntity);
    const includesNoAssignee = assigneeFilter.includes(NO_ASSIGNEE);
    const hasNoAssignees = taskAssignees.length === 0;

    // Match if task has no assignees and NO_ASSIGNEE filter is active
    if (includesNoAssignee && hasNoAssignees) {
      return true;
    }

    // Match if any of the task's assignees are in the filter
    if (!taskAssignees.some((id) => assigneeFilter.includes(id))) {
      return false;
    }
  }

  return true;
};
