import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import { createTask } from '@core/util/create';
import type { PotentialTask } from '@core/util/taskExtraction';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';

export type TaskConversionOptions = {
  /** Current user ID for auto-assignment when no assignees specified */
  currentUserId?: string;
  /** Parent task ID to associate created tasks with */
  parentTaskId?: string;
};

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

/**
 * If no assignees specified in the task, fall back to current user
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
 * Build PropertyInput array from a potential task
 */
function buildPropertyValues(
  task: PotentialTask,
  options: TaskConversionOptions
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
 * Create a single task from a potential task
 */
async function createTaskFromPotential(
  task: PotentialTask,
  options: TaskConversionOptions
): Promise<TaskCreationSuccess | TaskCreationError> {
  if (!task.title.trim()) {
    return { lineIndex: task.lineIndex, error: 'Empty task title' };
  }

  try {
    const propertyValues = buildPropertyValues(task, options);

    const documentId = await createTask({
      title: task.title,
      content: '',
      propertyValues,
    });

    if (!documentId) {
      return { lineIndex: task.lineIndex, error: 'No document ID returned' };
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
 * Create tasks from all potential tasks in parallel
 */
export async function createTasksFromPotential(
  tasks: PotentialTask[],
  options: TaskConversionOptions
): Promise<TaskCreationResults> {
  const results = await Promise.all(
    tasks.map((task) => createTaskFromPotential(task, options))
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
 * Lines that had tasks created are replaced with task mention markup.
 */
export function replaceCheckboxesWithMentions(
  markdown: string,
  createdTasks: TaskCreationSuccess[]
): string {
  const lines = markdown.split('\n');

  // Create a map of line index to created task for quick lookup
  const taskByLine = new Map<number, TaskCreationSuccess>();
  for (const task of createdTasks) {
    taskByLine.set(task.lineIndex, task);
  }

  // Replace checkbox lines with task mentions
  const resultLines = lines.map((line, index) => {
    const task = taskByLine.get(index);
    if (task) {
      return createTaskMentionMarkdown(task.documentId, task.title);
    }
    return line;
  });

  return resultLines.join('\n');
}
