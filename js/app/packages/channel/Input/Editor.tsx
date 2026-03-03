import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useInput } from './context';

export function Editor(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const input = useInput();
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('min-h-6 text-sm whitespace-pre-wrap break-words', local.class)}
      data-input-editor
      {...rest}
    >
      <Show
        when={local.children}
        fallback={
          <span class="text-ink-placeholder">
            {input().value?.trim() ? input().value : input().placeholder}
          </span>
        }
      >
        {local.children}
      </Show>
    </div>
  );
}
