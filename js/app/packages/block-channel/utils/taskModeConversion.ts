import type { PotentialTask } from '@core/util/taskExtraction';
import {
  createTaskFromData,
  type TaskCreationOptions,
} from '@core/util/taskCreation';

export type { TaskCreationOptions as TaskConversionOptions };

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
 * Create a single task from a potential task
 */
async function createTaskFromPotential(
  task: PotentialTask,
  options: TaskCreationOptions
): Promise<TaskCreationSuccess | TaskCreationError> {
  try {
    const result = await createTaskFromData(task, options);

    if (!result) {
      return { lineIndex: task.lineIndex, error: 'Empty task title' };
    }

    return {
      lineIndex: task.lineIndex,
      documentId: result.documentId,
      title: result.title,
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
  options: TaskCreationOptions
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
