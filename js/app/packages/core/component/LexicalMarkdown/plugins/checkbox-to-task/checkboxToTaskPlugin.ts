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
import { SYSTEM_PROPERTY_IDS } from '../../../Properties/constants';
import { createTask } from '../../../../util/create';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';
import type {
  ConvertCheckboxesOptions,
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

/**
 * Build PropertyInput array from parsed checkbox data
 */
function buildPropertyValues(checkbox: ParsedCheckbox): PropertyInput[] {
  const properties: PropertyInput[] = [];

  // Add assignees if present (ENTITY type, multi-select)
  if (checkbox.assigneeUserIds.length > 0) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
      value: {
        type: 'multi_entity_reference',
        references: checkbox.assigneeUserIds.map((userId) => ({
          entity_id: userId,
          entity_type: 'USER' as const,
        })),
      },
    });
  }

  // Add due date if present (DATE type)
  if (checkbox.dueDate) {
    properties.push({
      propertyId: SYSTEM_PROPERTY_IDS.DUE_DATE,
      value: {
        type: 'date',
        value: checkbox.dueDate,
      },
    });
  }

  return properties;
}

/**
 * Create a single task from a parsed checkbox
 */
async function createTaskFromCheckbox(
  checkbox: ParsedCheckbox
): Promise<TaskCreationResult> {
  // Skip empty checkboxes
  if (!checkbox.title.trim()) {
    return {
      success: false,
      nodeKey: checkbox.nodeKey,
      error: 'Empty checkbox - skipped',
    };
  }

  try {
    const propertyValues = buildPropertyValues(checkbox);

    const documentId = await createTask({
      title: checkbox.title,
      content: '',
      propertyValues: propertyValues.length > 0 ? propertyValues : undefined,
    });

    if (!documentId) {
      return {
        success: false,
        nodeKey: checkbox.nodeKey,
        error: 'Failed to create task - no document ID returned',
      };
    }

    return {
      success: true,
      nodeKey: checkbox.nodeKey,
      documentId,
      taskTitle: checkbox.title,
    };
  } catch (error) {
    return {
      success: false,
      nodeKey: checkbox.nodeKey,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
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

  // Create document mention for the task
  const mentionNode = $createDocumentMentionNode({
    documentId,
    documentName: taskTitle,
    blockName: 'task',
  });

  // Create a paragraph to hold the mention (replacing the list item)
  const paragraph = $createParagraphNode();
  paragraph.append(mentionNode);

  // Replace the checkbox with the paragraph
  node.replace(paragraph);
}

/**
 * Process checkboxes and create tasks in parallel, then batch replace all at once
 */
async function processCheckboxes(
  editor: LexicalEditor,
  checkboxes: ParsedCheckbox[],
  options: ConvertCheckboxesOptions
): Promise<void> {
  const { onComplete } = options;

  try {
    // Create all tasks in parallel
    const results = await Promise.all(checkboxes.map(createTaskFromCheckbox));

    // Batch replace all successful checkboxes in a single update
    const successfulResults = results.filter(
      (
        r
      ): r is TaskCreationResult & { documentId: string; taskTitle: string } =>
        r.success && !!r.documentId && !!r.taskTitle
    );

    if (successfulResults.length > 0) {
      editor.update(() => {
        for (const result of successfulResults) {
          $replaceCheckboxWithMention(
            result.nodeKey,
            result.documentId,
            result.taskTitle
          );
        }
      });
    }

    onComplete?.(results);
  } catch (error) {
    console.error('Error processing checkboxes:', error);
    onComplete?.([]);
  }
}

/**
 * Register the checkbox-to-task plugin
 */
function registerCheckboxToTaskPlugin(editor: LexicalEditor) {
  return editor.registerCommand(
    CONVERT_CHECKBOXES_TO_TASKS,
    (options: ConvertCheckboxesOptions) => {
      editor.update(
        () => {
          const selection = options.selection ?? $getSelection();
          if (!$isRangeSelection(selection)) {
            return;
          }

          const nodes = $getSelectedCheckboxes(selection);
          const checkboxes = $parseCheckboxNodes(nodes);

          if (checkboxes.length === 0) {
            options.onComplete?.([]);
            return;
          }

          processCheckboxes(editor, checkboxes, options);
        },
        { discrete: true }
      );

      return true;
    },
    COMMAND_PRIORITY_NORMAL
  );
}

/**
 * Plugin factory for checkbox-to-task conversion.
 * Registers the CONVERT_CHECKBOXES_TO_TASKS command.
 */
export function checkboxToTaskPlugin() {
  return (editor: LexicalEditor) => registerCheckboxToTaskPlugin(editor);
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
