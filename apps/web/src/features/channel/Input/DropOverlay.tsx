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
          'absolute inset-0 z-20 bg-modal-overlay flex items-center justify-center',
          local.class
        )}
        data-input-drop-overlay
        {...rest}
      >
        <div class="max-w-[min(28rem,calc(100%-3rem))] min-w-0 bg-surface border border-edge rounded-full px-4 py-2 font-sans text-xs text-ink-muted shadow-md">
          {resolved() ??
            local.hint ??
            'Drop any file here to add it to the conversation'}
        </div>
      </div>
    </Show>
  );
}
