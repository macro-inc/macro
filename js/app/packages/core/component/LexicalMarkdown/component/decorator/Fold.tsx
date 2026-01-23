import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import CaretDown from '@icon/regular/caret-down.svg';
import CaretRight from '@icon/regular/caret-right.svg';
import FileText from '@icon/regular/file-text.svg';
import { $isFoldNode, type FoldDecoratorProps } from '@lexical-core';
import { $getNodeByKey } from 'lexical';
import { createSignal, Show, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

export function Fold(props: FoldDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  const [isCollapsed, setIsCollapsed] = createSignal<boolean>(
    props.collapsed ?? true
  );

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const toggleCollapse = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newState = !isCollapsed();
    setIsCollapsed(newState);
    editor?.update(() => {
      const node = $getNodeByKey(props.key);
      if ($isFoldNode(node)) {
        node.setCollapsed(newState);
      }
    });
  };

  const isCodeLike = () => {
    const blockName = props.blockName.toLowerCase();
    return (
      blockName === 'code' ||
      blockName === 'source' ||
      blockName.includes('script') ||
      blockName.endsWith('.ts') ||
      blockName.endsWith('.js') ||
      blockName.endsWith('.py') ||
      blockName.endsWith('.go') ||
      blockName.endsWith('.rs')
    );
  };

  return (
    <div
      class="fold-node-container my-2 border border-edge rounded-md overflow-hidden"
      classList={{
        'ring-2 ring-accent/50': isSelectedAsNode(),
      }}
    >
      <button
        type="button"
        class="fold-header flex items-center gap-2 px-3 py-2 w-full bg-background-secondary hover:bg-hover text-left transition-colors"
        onClick={toggleCollapse}
      >
        <span class="text-ink-muted transition-transform">
          <Show when={!isCollapsed()} fallback={<CaretRight class="size-4" />}>
            <CaretDown class="size-4" />
          </Show>
        </span>
        <span class="size-4 flex-shrink-0">
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
        <span class="text-sm font-medium text-ink truncate">
          {props.documentName || 'Untitled'}
        </span>
      </button>
      <Show when={!isCollapsed()}>
        <div class="fold-content border-t border-edge">
          <div class="max-h-96 overflow-auto">
            <pre
              class="p-3 text-sm whitespace-pre-wrap break-words"
              classList={{
                'font-mono text-xs bg-background-secondary': isCodeLike(),
                'text-ink': !isCodeLike(),
              }}
            >
              {props.content || '(No content)'}
            </pre>
          </div>
        </div>
      </Show>
    </div>
  );
}
