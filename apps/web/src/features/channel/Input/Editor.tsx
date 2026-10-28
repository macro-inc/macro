import { cn } from '@ui';
import { children, type JSX, Show, splitProps } from 'solid-js';
import { useInput } from './context';

export function Editor(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const input = useInput();
  const [local, rest] = splitProps(props, ['class', 'children']);
  const resolved = children(() => local.children);

  return (
    <div
      class={cn(
        'ph-no-capture min-h-6 text-base whitespace-pre-wrap wrap-break-word',
        'not-touch:min-h-[24.375px]',
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
