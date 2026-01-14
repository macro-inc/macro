import { $createDocumentMentionNode } from '@lexical-core';
import { $isListItemNode } from '@lexical/list';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';
import { err, ok } from 'neverthrow';
import { SYSTEM_PROPERTY_IDS } from '../../../Properties/constants';
import { createTask } from '../../../../util/create';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';
import type {
  ConvertCheckboxesOptions,
  ConvertCheckboxesPluginOptions,
  ParsedCheckbox,
  TaskCreationResult,
} from './types';
import { $getSelectedCheckboxes } from './checkboxDetection';
import { $parseCheckboxNodes } from './checkboxParsing';

/**
 * Command to convert selected checkboxes to tasks
 */
export const CONVERT_CHECKBOXES_TO_TASKS: LexicalCommand<ConvertCheckboxesOptions> =
  createCommand('CONVERT_CHECKBOXES_TO_TASKS');

function maybeFallbackToCurrentAssignee(
  asigneeUserIds: string[],
  currentUserId?: string
): string[] {
  if (asigneeUserIds.length > 0) return asigneeUserIds;
  if (currentUserId) return [currentUserId];
  return [];
}

/**
 * Build PropertyInput array from parsed checkbox data.
 * Auto-assigns to current user when no assignees are extracted.
 */
function buildPropertyValues(
  checkbox: ParsedCheckbox,
  currentUserId?: string,
  parentTaskId?: string
): PropertyInput[] {
  const properties: PropertyInput[] = [];

  const assigneeIds = maybeFallbackToCurrentAssignee(
    checkbox.assigneeUserIds,
    currentUserId
  );

  if (assigneeIds) {
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

  if (checkbox.dueDate) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.DUE_DATE,
      value: {
        type: 'date',
        value: checkbox.dueDate,
      },
    });
  }

  if (parentTaskId) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.PARENT_TASK,
      value: {
        type: 'entity_reference',
        reference: {
          entity_id: parentTaskId,
          entity_type: 'TASK' as const,
        },
      },
    });
  }

  return properties;
}

/**
 * Create a single task from a parsed checkbox
 */
async function createTaskFromCheckbox(
  checkbox: ParsedCheckbox,
  currentUserId?: string,
  parentTaskId?: string
): Promise<TaskCreationResult> {
  if (!checkbox.title.trim()) {
    return err({ tag: 'EmptyCheckbox', nodeKey: checkbox.nodeKey });
  }

  try {
    const propertyValues = buildPropertyValues(
      checkbox,
      currentUserId,
      parentTaskId
    );

    const documentId = await createTask({
      title: checkbox.title,
      content: '',
      propertyValues,
    });

    if (!documentId) {
      return err({ tag: 'NoDocumentId', nodeKey: checkbox.nodeKey });
    }

    return ok({
      nodeKey: checkbox.nodeKey,
      documentId,
      taskTitle: checkbox.title,
    });
  } catch (error) {
    return err({
      tag: 'ApiError',
      nodeKey: checkbox.nodeKey,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Replace a checkbox ListItemNode with a paragraph containing a task mention.
 * Must be called within Lexical update context.
 */
function $replaceCheckboxWithMention(
  nodeKey: string,
  documentId: string,
  taskTitle: string
): void {
  const node = $getNodeByKey(nodeKey);
  if (!node || !$isListItemNode(node)) return;

  const mentionNode = $createDocumentMentionNode({
    documentId,
    documentName: taskTitle,
    blockName: 'task',
  });

  const paragraph = $createParagraphNode();
  paragraph.append(mentionNode);
  node.replace(paragraph);
}

/**
 * Process checkboxes and create tasks in parallel, then batch replace all at once
 */
async function processCheckboxes(
  editor: LexicalEditor,
  checkboxes: ParsedCheckbox[],
  options: ConvertCheckboxesOptions,
  pluginOptions?: ConvertCheckboxesPluginOptions
): Promise<void> {
  const { onComplete } = options;

  const results = await Promise.all(
    checkboxes.map((checkbox) =>
      createTaskFromCheckbox(
        checkbox,
        pluginOptions?.currentUserId,
        pluginOptions?.parentTaskId
      )
    )
  );

  // Extract successful results for DOM replacement
  const successes = results.flatMap((r) => (r.isOk() ? [r.value] : []));

  if (successes.length > 0) {
    editor.update(
      () => {
        for (const { nodeKey, documentId, taskTitle } of successes) {
          $replaceCheckboxWithMention(nodeKey, documentId, taskTitle);
        }
      },
      { discrete: true }
    );
  }

  onComplete?.(results);
}

/**
 * Register the checkbox-to-task plugin
 */
function registerCheckboxToTaskPlugin(
  editor: LexicalEditor,
  pluginOptions?: ConvertCheckboxesPluginOptions
) {
  return editor.registerCommand(
    CONVERT_CHECKBOXES_TO_TASKS,
    (options: ConvertCheckboxesOptions) => {
      const selection = options.selection ?? $getSelection();
      if (!$isRangeSelection(selection)) {
        return false;
      }

      const nodes = $getSelectedCheckboxes(selection);
      const checkboxes = $parseCheckboxNodes(nodes);

      if (checkboxes.length === 0) {
        options.onComplete?.([]);
        return false;
      }

      processCheckboxes(editor, checkboxes, options, pluginOptions);

      return true;
    },
    COMMAND_PRIORITY_NORMAL
  );
}

/**
 * Plugin factory for checkbox-to-task conversion.
 * Registers the CONVERT_CHECKBOXES_TO_TASKS command.
 */
export function checkboxToTaskPlugin(
  pluginOptions?: ConvertCheckboxesPluginOptions
) {
  return (editor: LexicalEditor) =>
    registerCheckboxToTaskPlugin(editor, pluginOptions);
}

/**
 * Utility to check if conversion is available for current selection.
 * Must be called within Lexical read/update context.
 */
export function $canConvertCheckboxesToTasks(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  return $getSelectedCheckboxes(selection).length > 0;
}

export function isCheckboxToTaskPluginEnabled(editor: LexicalEditor): boolean {
  return editor._commands.has(CONVERT_CHECKBOXES_TO_TASKS);
}
