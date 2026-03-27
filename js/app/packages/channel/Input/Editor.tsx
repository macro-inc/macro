import { children, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useInput } from './context';

export function Editor(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const input = useInput();
  const [local, rest] = splitProps(props, ['class', 'children']);
  const resolved = children(() => local.children);

  return (
    <div
      class={cn(
        'ph-no-capture min-h-6 text-sm whitespace-pre-wrap break-words',
        local.class
      )}
      data-input-editor
      {...rest}
    >
      <Show
        when={resolved()}
        fallback={
          <span class="text-ink-placeholder">
            {input().value?.trim() ? input().value : input().placeholder}
          </span>
        }
      >
        {(children) => children()}
      </Show>
    </div>
  );
}
