import { ListNode, type SerializedListNode } from '@lexical/list';
import {
  $getState,
  $setState,
  createState,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  setDOMUnmanaged,
} from 'lexical';

/**
 * Persisted display settings for a task check list: how the document shows the
 * list, not what the list contains. Stored as node state so it rides the
 * shared `$` bag through serialization, collab sync, and history.
 */
export type TaskListViewSettings = {
  filters?: {
    status?: string[];
    priority?: string[];
    assignees?: string[];
    due?: string[];
  };
};

export const taskListViewState = createState('taskListView', {
  parse: (value): TaskListViewSettings | null =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as TaskListViewSettings)
      : null,
});

export function $getTaskListViewSettings(
  node: LexicalNode
): TaskListViewSettings | null {
  return $getState(node, taskListViewState);
}

export function $setTaskListViewSettings(
  node: LexicalNode,
  settings: TaskListViewSettings | null
) {
  $setState(node, taskListViewState, settings);
}

/** The non-lexical chrome mount a check list carries inside its own element. */
export const TASK_LIST_BAR_CLASS = 'mdtl-bar-mount';

/**
 * Drop-in replacement for ListNode. Check lists additionally carry one
 * non-lexical mount element inside the `<ul>` — a control line before the
 * items — anchored off the managed child range through `getDOMSlot`, so the
 * reconciler never touches it. The app portals its task-list controls into
 * this mount.
 *
 * Serializes as `task-list` with the exact `list` wire shape; legacy `list`
 * nodes import through the ListNode replacement, so both types deserialize to
 * this class.
 */
export class TaskListNode extends ListNode {
  static getType() {
    return 'task-list';
  }

  static clone(node: TaskListNode) {
    return new TaskListNode(node.__listType, node.__start, node.__key);
  }

  static importJSON(serializedNode: SerializedListNode) {
    return new TaskListNode(
      serializedNode.listType,
      serializedNode.start
    ).updateFromJSON(serializedNode as LexicalUpdateJSON<SerializedListNode>);
  }

  static importDOM() {
    return ListNode.importDOM?.() ?? null;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    if (this.getListType() === 'check') {
      const bar = document.createElement('div');
      bar.className = TASK_LIST_BAR_CLASS;
      bar.contentEditable = 'false';
      setDOMUnmanaged(bar);
      element.prepend(bar);
    }
    return element;
  }

  exportDOM(editor: LexicalEditor) {
    // ListNode.exportDOM reuses createDOM; keep the chrome mount out of
    // exported (clipboard) HTML.
    const output = super.exportDOM(editor);
    const element = output.element;
    if (element instanceof HTMLElement) {
      element.querySelector(`:scope > .${TASK_LIST_BAR_CLASS}`)?.remove();
    }
    return output;
  }

  getDOMSlot(element: HTMLElement) {
    const slot = super.getDOMSlot(element);
    const bar = element.querySelector(`:scope > .${TASK_LIST_BAR_CLASS}`);
    return bar ? slot.withAfter(bar) : slot;
  }
}

export function $isTaskListNode(
  node: LexicalNode | null | undefined
): node is TaskListNode {
  return node instanceof TaskListNode;
}
