import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';
import { createTask } from './create';

export type TaskData = {
  title: string;
  assigneeUserIds: string[];
  dueDate: string | null;
  /** Optional status option ID */
  statusOptionId?: string | null;
  /** Optional priority option ID */
  priorityOptionId?: string | null;
};

export type TaskCreationOptions = {
  /** Current user ID for auto-assignment when no assignees specified */
  currentUserId?: string;
  /** Parent task ID to associate created tasks with */
  parentTaskId?: string;
};

export type CreatedTask = {
  documentId: string;
  title: string;
};

function maybeFallbackToCurrentAssignee(
  assigneeUserIds: string[],
  currentUserId?: string
): string[] {
  if (assigneeUserIds.length > 0) return assigneeUserIds;
  if (currentUserId) return [currentUserId];
  return [];
}

function buildTaskPropertyValues(
  task: TaskData,
  options: TaskCreationOptions
): PropertyInput[] {
  const properties: PropertyInput[] = [];

  const assigneeIds = maybeFallbackToCurrentAssignee(
    task.assigneeUserIds,
    options.currentUserId
  );

  if (assigneeIds.length > 0) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
      value: {
        type: 'multi_entity_reference',
        references: assigneeIds.map((userId) => ({
          entity_id: userId,
          entity_type: 'USER' as const,
        })),
      },
    });
  }

  if (task.dueDate) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.DUE_DATE,
      value: {
        type: 'date',
        value: task.dueDate,
      },
    });
  }

  if (task.statusOptionId) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.STATUS,
      value: {
        type: 'select_option',
        option_id: task.statusOptionId,
      },
    });
  }

  if (task.priorityOptionId) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.PRIORITY,
      value: {
        type: 'select_option',
        option_id: task.priorityOptionId,
      },
    });
  }

  if (options.parentTaskId) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.PARENT_TASK,
      value: {
        type: 'entity_reference',
        reference: {
          entity_id: options.parentTaskId,
          entity_type: 'TASK' as const,
        },
      },
    });
  }

  return properties;
}

export async function createTaskFromData(
  task: TaskData,
  options: TaskCreationOptions
): Promise<CreatedTask | null> {
  if (!task.title.trim()) {
    return null;
  }

  const propertyValues = buildTaskPropertyValues(task, options);

  const documentId = await createTask({
    title: task.title,
    content: '',
    propertyValues,
  });

  if (!documentId) {
    return null;
  }

  return {
    documentId,
    title: task.title,
  };
}
