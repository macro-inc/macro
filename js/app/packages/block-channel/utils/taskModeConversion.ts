import type { TaskWithProperties } from '../hooks/taskmode';
import { propertyValueToApi } from '@core/component/Properties/api/converters';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import { createTask } from '@core/util/create';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';
import { err, ok, type Result } from 'neverthrow';

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
};

function buildPropertyInputs(
  task: TaskWithProperties,
  options: TaskCreationOptions
): PropertyInput[] {
  const properties: PropertyInput[] = [];

  for (const [propertyId, apiValue] of Object.entries(task.propertyValues)) {
    // Only ASSIGNEES is multi-select; STATUS and PRIORITY are single-select
    const isMultiSelect = propertyId === SYSTEM_PROPERTY_IDS.ASSIGNEES;

    const value = propertyValueToApi(apiValue, isMultiSelect);
    if (value !== null) {
      properties.push({ propertyId, value });
    }
  }

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

  if (task.dueDate && !task.propertyValues[SYSTEM_PROPERTY_IDS.DUE_DATE]) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.DUE_DATE,
      value: { type: 'date', value: task.dueDate.toISOString() },
    });
  }

  return properties;
}

async function createSingleTask(
  task: TaskWithProperties,
  options: TaskCreationOptions
): Promise<Result<TaskCreationSuccess, TaskCreationError>> {
  if (!task.title.trim()) {
    return err({ lineIndex: task.lineIndex, error: 'Empty task title' });
  }

  try {
    const propertyValues = buildPropertyInputs(task, options);

    const documentId = await createTask({
      title: task.title,
      content: '',
      propertyValues: propertyValues.length > 0 ? propertyValues : undefined,
    });

    if (!documentId) {
      return err({ lineIndex: task.lineIndex, error: 'Failed to create task' });
    }

    return ok({
      lineIndex: task.lineIndex,
      documentId,
      title: task.title,
    });
  } catch (error) {
    return err({
      lineIndex: task.lineIndex,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

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
    if (result.isOk()) {
      successes.push(result.value);
    } else {
      errors.push(result.error);
    }
  }

  return { successes, errors };
}

function createTaskMentionMarkdown(documentId: string, title: string): string {
  const data = JSON.stringify({
    documentId,
    documentName: title,
    blockName: 'task',
  });
  return `<m-document-mention>${data}</m-document-mention>`;
}

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
