import { $isListItemNode, $isListNode, type ListItemNode } from '@lexical/list';
import { debounce } from '@solid-primitives/scheduled';
import {
  $getRoot,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode,
  type UpdateListener,
} from 'lexical';
import { createStore, type SetStoreFunction } from 'solid-js/store';

export type ProgressStats = {
  completed: number;
  total: number;
};

export function createProgressStatsStore() {
  return createStore<ProgressStats>({
    completed: 0,
    total: 0,
  });
}

function $hasNestedList(node: ListItemNode): boolean {
  return node.getChildren().some($isListNode);
}

function $hasTextContent(node: ListItemNode): boolean {
  return node.getTextContent().trim() !== '';
}

export function $getProgressStats(): ProgressStats {
  const stats: ProgressStats = {
    completed: 0,
    total: 0,
  };

  function visit(node: LexicalNode) {
    if ($isListItemNode(node)) {
      const checked = node.getChecked();
      if (
        typeof checked === 'boolean' &&
        !$hasNestedList(node) &&
        $hasTextContent(node)
      ) {
        stats.total += 1;
        if (checked) stats.completed += 1;
      }
    }

    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child);
      }
    }
  }

  visit($getRoot());

  return stats;
}

type ProgressPluginProps = {
  setStore: SetStoreFunction<ProgressStats>;
  debounceTime: number;
};

function registerProgressPlugin(
  editor: LexicalEditor,
  props: ProgressPluginProps
) {
  const countProgress: UpdateListener = ({ editorState }) => {
    const stats = editorState.read($getProgressStats);
    props.setStore('completed', stats.completed);
    props.setStore('total', stats.total);
  };

  const debouncedCountProgress = debounce(countProgress, props.debounceTime);
  return editor.registerUpdateListener(debouncedCountProgress);
}

export function progressPlugin(props: ProgressPluginProps) {
  return (editor: LexicalEditor) => registerProgressPlugin(editor, props);
}
