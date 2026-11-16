import { IS_MAC } from '@core/constant/isMac';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { KEY_DOWN_COMMAND } from '@macro-inc/lexical-wasm-view/view/commands';
import type { Accessor } from 'solid-js';
import {
  dispatchApplicationCommandIfSessionEdit,
  queryApplication,
} from '../group-b/command';
import { extractDateMention, extractUserMentions } from './checkboxParsing';
import { createTaskFromCheckbox } from './checkboxToTaskPlugin';
import type {
  ConvertCheckboxesPluginOptions,
  ParsedCheckbox,
  TaskCreationResult,
} from './types';

function selectedCheckboxes(view: EditorView): ParsedCheckbox[] | null {
  const reply = queryApplication(view, 'group-b.selected-checkboxes', {});
  if (reply === null) return null;
  if (!Array.isArray(reply))
    throw new Error('Invalid native checkbox selection reply');
  return reply.map((item: unknown) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('key' in item) ||
      typeof item.key !== 'number' ||
      !('title' in item) ||
      typeof item.title !== 'string' ||
      !('markdown' in item) ||
      typeof item.markdown !== 'string'
    )
      throw new Error('Invalid native checkbox');
    // Source $parseCheckboxNode, over the model's title and internal Markdown.
    return {
      nodeKey: String(item.key),
      title: item.title,
      rawMarkdown: item.markdown,
      assigneeUserIds: extractUserMentions(item.markdown),
      dueDate: extractDateMention(item.markdown),
    };
  });
}

/**
 * Source CONVERT_CHECKBOXES_TO_TASKS over the native model: every selected
 * checklist item becomes a task, created in parallel, then all created items
 * are replaced by task mentions in one write. False when nothing converts.
 */
export function convertNativeCheckboxesToTasks(
  view: EditorView,
  pluginOptions: ConvertCheckboxesPluginOptions,
  onComplete?: (results: TaskCreationResult[]) => void
): boolean {
  const generation = view.mirror.keyGeneration;
  if (generation === null) return false;
  const checkboxes = selectedCheckboxes(view);
  if (checkboxes === null) return false;
  if (checkboxes.length === 0) {
    onComplete?.([]);
    return false;
  }
  const process = async () => {
    const results = await Promise.all(
      checkboxes.map((checkbox) =>
        createTaskFromCheckbox(
          checkbox,
          pluginOptions.currentUserId,
          pluginOptions.parentTaskId
        )
      )
    );
    const created = results.flatMap((result) =>
      result.isOk() ? [result.value] : []
    );
    // A replaced document has new keys; its items are no longer these.
    if (
      created.length > 0 &&
      view.isMounted &&
      view.mirror.keyGeneration === generation
    )
      dispatchApplicationCommandIfSessionEdit(
        view,
        'group-b.checkbox-task-mentions',
        {
          items: created.map((item) => ({
            key: Number(item.nodeKey),
            documentId: item.documentId,
            taskTitle: item.taskTitle,
          })),
        }
      );
    onComplete?.(results);
  };
  fireAndForget(process(), 'checkbox-to-task');
  return true;
}

/** Source's Mod+Shift+O shortcut (registerMarkdownEditing). */
function isConvertShortcut(event: KeyboardEvent) {
  return (
    event.code === 'KeyO' &&
    event.shiftKey &&
    (IS_MAC ? event.metaKey : event.ctrlKey)
  );
}

export function registerNativeCheckboxToTaskShortcut(
  view: EditorView,
  options: {
    currentUserId: Accessor<string | undefined>;
    parentTaskId?: string;
  }
): () => void {
  return view.registerViewCommand(
    KEY_DOWN_COMMAND,
    (event) => {
      if (!isConvertShortcut(event)) return false;
      // Source keyboardShortcutsPlugin consumes the matched key first.
      event.preventDefault();
      event.stopPropagation();
      const currentUserId = options.currentUserId();
      if (!currentUserId) return true;
      convertNativeCheckboxesToTasks(view, {
        currentUserId,
        parentTaskId: options.parentTaskId,
      });
      return true;
    },
    2
  );
}
