import type {
  EntityData,
  TaskEntityWithProperties,
} from '@entity/types/entity';
import { getTaskAssigneeIds } from '@entity/utils/task-properties';
import type { Query } from '../filter-store';

/** Whether a task is owned by or assigned to the current user. */
export const isMyTask = (
  entity: EntityData,
  userId: string | undefined
): boolean => {
  if (
    entity.type !== 'document' ||
    entity.subType?.type !== 'task' ||
    !userId
  ) {
    return false;
  }

  return (
    entity.ownerId === userId ||
    getTaskAssigneeIds(entity as TaskEntityWithProperties).includes(userId)
  );
};

/** Server-side owner-or-assignee scope for the My tasks tab. */
export const getMyTasksQuery = (userId: string): Query => ({
  include: { subType: ['task'] },
  documentWhere: {
    op: 'or',
    clauses: [
      { include: { documentOwnerId: [userId] } },
      { include: { documentImportance: true } },
    ],
  },
});
