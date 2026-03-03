import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useInput } from './context';

export function AttachMenu(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const input = useInput();
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <Show when={input().showAttachMenu}>
      <div class={cn('w-full', local.class)} data-input-attach-menu {...rest}>
        {local.children}
      </div>
    </Show>
  );
}
