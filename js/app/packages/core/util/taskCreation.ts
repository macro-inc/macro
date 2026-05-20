import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';
import { createTask } from './create';

/**
 * Maximum task name length in grapheme clusters, matching the backend validation
 * in rust/cloud-storage/documents/src/domain/service.rs (limit: 100).
 * Small buffer accounts for possible Unicode version differences between
 * JS Intl.Segmenter and Rust's unicode-segmentation crate.
 */
const MAX_TASK_NAME_LENGTH = 97;

type TaskData = {
  title: string;
  rawMarkdown: string;
  assigneeUserIds: string[];
  dueDate: Date | null;
};

type TaskCreationOptions = {
  currentUserId?: string;
  parentTaskId?: string;
};

function buildPropertyInputs(
  task: TaskData,
  options: TaskCreationOptions
): PropertyInput[] {
  const properties: PropertyInput[] = [];

  const assigneeIds =
    task.assigneeUserIds.length > 0
      ? task.assigneeUserIds
      : options.currentUserId
        ? [options.currentUserId]
        : [];

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
      value: { type: 'date', value: task.dueDate.toISOString() },
    });
  }

  properties.push({
    propertyId: SYSTEM_PROPERTY_IDS.STATUS,
    value: {
      type: 'select_option',
      option_id: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
    },
  });

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

function toGraphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text)).map((s) => s.segment);
}

export async function createTaskFromData(
  task: TaskData,
  options: TaskCreationOptions
): Promise<string | null> {
  if (!task.title.trim()) return null;

  const graphemes = toGraphemes(task.title);
  const titleExceedsLimit = graphemes.length > MAX_TASK_NAME_LENGTH;
  const title = titleExceedsLimit
    ? graphemes.slice(0, MAX_TASK_NAME_LENGTH).join('')
    : task.title;
  const content = titleExceedsLimit ? task.rawMarkdown : '';

  const propertyValues = buildPropertyInputs(task, options);

  const documentId = await createTask({
    title,
    content,
    propertyValues: propertyValues.length > 0 ? propertyValues : undefined,
  });

  return documentId ?? null;
}
