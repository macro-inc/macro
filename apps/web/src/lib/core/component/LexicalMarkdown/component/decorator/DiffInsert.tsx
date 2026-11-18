import { useUserId } from '@core/context/user';
import type { DiffInsertDecoratorProps } from '@macro-inc/lexical-core';
import { createMemo, Show, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { useDiffInsertHost } from '../../decorator-host/diff-insert-host';
import { StaticMarkdown } from '../core/StaticMarkdown';

export function DiffInsert(props: DiffInsertDecoratorProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const editor = () => wrapper?.editor;
  const host = useDiffInsertHost();
  const userId = useUserId();

  const shouldShow = createMemo(() => {
    const owner = host.diffInsert.owner(props.key);
    return owner !== null && owner.userId === userId();
  });

  return (
    <Show when={shouldShow()}>
      <div class="md-diff-insert select-none">
        <StaticMarkdown markdown={props.markdown} parentEditor={editor()} />
      </div>
    </Show>
  );
}
