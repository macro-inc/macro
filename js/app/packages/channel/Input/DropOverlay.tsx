import { children, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui';
import { useInput } from './context';
import { isReplyInput } from './types';

type DropOverlayProps = JSX.HTMLAttributes<HTMLDivElement> & {
  invalidMessage?: string;
  hint?: string;
};

export function DropOverlay(props: DropOverlayProps) {
  const input = useInput();
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'invalidMessage',
    'hint',
  ]);
  const resolved = children(() => local.children);

  const open = () =>
    !!input().isDraggedOver ||
    (!!input().isDraggingOverChannel && !isReplyInput(input()));
  const valid = () => input().isValidChannelDrag !== false;

  return (
    <Show when={open()}>
      <div
        class={cn(
          'absolute inset-0 z-20 bg-modal-overlay pattern-diagonal-8 flex items-center justify-center',
          valid() ? 'pattern-edge-muted' : 'pattern-failure-bg',
          local.class
        )}
        data-input-drop-overlay
        {...rest}
      >
        <div class="bg-menu border border-edge px-8 py-4 text-xs text-ink-muted shadow-md font-mono">
          <Show
            when={valid()}
            fallback={local.invalidMessage ?? 'Invalid file'}
          >
            {resolved() ??
              local.hint ??
              'Drop any file here to add it to the conversation'}
          </Show>
        </div>
      </div>
    </Show>
  );
}
