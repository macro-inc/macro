import type { TaskWithProperties } from './useTaskMode';
import { propertyValueToApi } from '@core/component/Properties/api/converters';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import { createTask } from '@core/util/create';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';

export type TaskCreationSuccess = {
  lineIndex: number;
  documentId: string;
  title: string;
};

export type TaskCreationError = {
  lineIndex: number;
  error: string;
};

export type TaskCreationResults = {
  successes: TaskCreationSuccess[];
  errors: TaskCreationError[];
};

export type TaskCreationOptions = {
  currentUserId?: string;
  parentTaskId?: string;
};

/**
 * Convert TaskWithProperties to PropertyInput[] for task creation API.
 * Follows the same pattern as ComposeTask.
 */
function buildPropertyInputs(
  task: TaskWithProperties,
  options: TaskCreationOptions
): PropertyInput[] {
  const properties: PropertyInput[] = [];

  // Convert stored PropertyApiValues to API format
  for (const [propertyId, apiValue] of Object.entries(task.propertyValues)) {
    // Determine if multi-select based on property type
    const isMultiSelect =
      propertyId === SYSTEM_PROPERTY_IDS.ASSIGNEES ||
      apiValue.valueType === 'SELECT_STRING' ||
      apiValue.valueType === 'SELECT_NUMBER';

    const value = propertyValueToApi(apiValue, isMultiSelect);
    if (value !== null) {
      properties.push({ propertyId, value });
    }
  }

  // Add assignees from extracted mentions if not already set
  if (
    task.assigneeUserIds.length > 0 &&
    !task.propertyValues[SYSTEM_PROPERTY_IDS.ASSIGNEES]
  ) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
      value: {
        type: 'multi_entity_reference',
        references: task.assigneeUserIds.map((id) => ({
          entity_id: id,
          entity_type: 'USER' as const,
        })),
      },
    });
  } else if (
    !task.propertyValues[SYSTEM_PROPERTY_IDS.ASSIGNEES] &&
    options.currentUserId
  ) {
    // Fall back to current user if no assignees
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
      value: {
        type: 'multi_entity_reference',
        references: [
          { entity_id: options.currentUserId, entity_type: 'USER' as const },
        ],
      },
    });
  }

  // Add due date from extracted mention if not already set
  if (task.dueDate && !task.propertyValues[SYSTEM_PROPERTY_IDS.DUE_DATE]) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.DUE_DATE,
      value: { type: 'date', value: task.dueDate },
    });
  }

  // Add parent task if specified
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
 * Create a single task from TaskWithProperties
 */
async function createSingleTask(
  task: TaskWithProperties,
  options: TaskCreationOptions
): Promise<TaskCreationSuccess | TaskCreationError> {
  if (!task.title.trim()) {
    return { lineIndex: task.lineIndex, error: 'Empty task title' };
  }

  try {
    const propertyValues = buildPropertyInputs(task, options);

    const documentId = await createTask({
      title: task.title,
      content: '',
      propertyValues: propertyValues.length > 0 ? propertyValues : undefined,
    });

    if (!documentId) {
      return { lineIndex: task.lineIndex, error: 'Failed to create task' };
    }

    return {
      lineIndex: task.lineIndex,
      documentId,
      title: task.title,
    };
  } catch (error) {
    return {
      lineIndex: task.lineIndex,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function isSuccess(
  result: TaskCreationSuccess | TaskCreationError
): result is TaskCreationSuccess {
  return 'documentId' in result;
}

/**
 * Create tasks from TaskWithProperties array in parallel
 */
export async function createTasksFromPotential(
  tasks: TaskWithProperties[],
  options: TaskCreationOptions
): Promise<TaskCreationResults> {
  const results = await Promise.all(
    tasks.map((task) => createSingleTask(task, options))
  );

  const successes: TaskCreationSuccess[] = [];
  const errors: TaskCreationError[] = [];

  for (const result of results) {
    if (isSuccess(result)) {
      successes.push(result);
    } else {
      errors.push(result);
    }
  }

  return { successes, errors };
}

/**
 * Generate markdown for a task mention
 */
function createTaskMentionMarkdown(documentId: string, title: string): string {
  const data = JSON.stringify({
    documentId,
    documentName: title,
    blockName: 'task',
  });
  return `<m-document-mention>${data}</m-document-mention>`;
}

/**
 * Replace checkbox lines in markdown with task mentions.
 */
export function replaceCheckboxesWithMentions(
  markdown: string,
  createdTasks: TaskCreationSuccess[]
): string {
  const lines = markdown.split('\n');

  const taskByLine = new Map<number, TaskCreationSuccess>();
  for (const task of createdTasks) {
    taskByLine.set(task.lineIndex, task);
  }

  const resultLines = lines.map((line, index) => {
    const task = taskByLine.get(index);
    if (task) {
      return createTaskMentionMarkdown(task.documentId, task.title);
    }
    return line;
  });

  return resultLines.join('\n');
}
