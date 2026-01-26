import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import FileText from '@icon/regular/file-text.svg';
import { type FoldDecoratorProps } from '@lexical-core';
import { createMemo, Show, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

export function Fold(props: FoldDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;

  const isSelectedAsNode = createMemo(() => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  });

  return (
    <span class="relative">
      <span
        class="w-full h-full py-0.5 cursor-default rounded-xs hover:bg-hover focus:bg-active"
        classList={{
          'bg-active text-ink bracket bracket-offset-2': isSelectedAsNode(),
        }}
        style={{
          'user-select': 'inherit',
        }}
      >
        <span class="pointer-events-auto">
          <span class="relative top-[0.125em] size-[1em] inline-flex mx-1">
            <Show
              when={props.blockName && props.blockName !== 'unknown'}
              fallback={<FileText class="size-4 text-ink-muted" />}
            >
              <EntityIcon
                targetType={props.blockName as EntityIconSelector}
                size="fill"
              />
            </Show>
          </span>
          <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
            {props.documentName || 'Untitled'}
          </span>
        </span>
      </span>
    </span>
  );
}
