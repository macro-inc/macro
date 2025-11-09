import type { DiffInsertDecoratorProps } from '@lexical-core';
import { $isDiffNode } from '@lexical-core';
import { useUserId } from '@service-gql/client';
import { $getNodeByKey } from 'lexical';
import { createMemo, Show, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { StaticMarkdown } from '../core/StaticMarkdown';

export function DiffInsert(props: DiffInsertDecoratorProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const editor = () => wrapper?.editor;
  const userId = useUserId();

  const shouldShow = createMemo(() => {
    return editor()
      ?.getEditorState()
      .read(() => {
        const node = $getNodeByKey(props.key);
        if (!node) return false;

        const parent = node.getParent();
        if (!parent || !$isDiffNode(parent)) return false;

        return parent.getUserId() === userId();
      });
  });

  return (
    <Show when={shouldShow()}>
      <div class="md-diff-insert select-none">
        <StaticMarkdown markdown={props.markdown} parentEditor={editor()} />
      </div>
    </Show>
  );
}
