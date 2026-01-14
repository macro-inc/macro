/**
 * Shared utilities for creating tasks from parsed checkbox/task data.
 * Used by both the Lexical checkbox-to-task plugin and channel Task Mode.
 */

import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';
import { createTask } from './create';

/**
 * Common task data needed for creation (shared between ParsedCheckbox and PotentialTask)
 */
export type TaskData = {
  title: string;
  assigneeUserIds: string[];
  dueDate: string | null;
  /** Optional status option ID */
  statusOptionId?: string | null;
  /** Optional priority option ID */
  priorityOptionId?: string | null;
};

/**
 * Options for task creation
 */
export type TaskCreationOptions = {
  /** Current user ID for auto-assignment when no assignees specified */
  currentUserId?: string;
  /** Parent task ID to associate created tasks with */
  parentTaskId?: string;
};

/**
 * Result of a successful task creation
 */
export type CreatedTask = {
  documentId: string;
  title: string;
};

/**
 * If no assignees specified, fall back to current user
 */
function maybeFallbackToCurrentAssignee(
  assigneeUserIds: string[],
  currentUserId?: string
): string[] {
  if (assigneeUserIds.length > 0) return assigneeUserIds;
  if (currentUserId) return [currentUserId];
  return [];
}

/**
 * Build PropertyInput array from task data.
 * Auto-assigns to current user when no assignees are extracted.
 */
export function buildTaskPropertyValues(
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

/**
 * Create a task from task data. Returns the created task info or null on failure.
 * Throws on API errors.
 */
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
