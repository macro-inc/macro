import { cn } from '@ui';
import { children, type JSX, Show, splitProps } from 'solid-js';
import { useInput } from './context';

type DropOverlayProps = JSX.HTMLAttributes<HTMLDivElement> & {
  hint?: string;
};

export function DropOverlay(props: DropOverlayProps) {
  const input = useInput();
  const [local, rest] = splitProps(props, ['class', 'children', 'hint']);
  const resolved = children(() => local.children);

  return (
    <Show when={input().isDraggedOver}>
      <div
        class={cn(
          'absolute inset-0 z-20 bg-modal-overlay pattern-diagonal-8 pattern-edge-muted flex items-center justify-center',
          local.class
        )}
        data-input-drop-overlay
        {...rest}
      >
        <div class="bg-surface border border-edge px-8 py-4 text-xs text-ink-muted shadow-md font-mono">
          {resolved() ??
            local.hint ??
            'Drop any file here to add it to the conversation'}
        </div>
      </div>
    </Show>
  );
}
