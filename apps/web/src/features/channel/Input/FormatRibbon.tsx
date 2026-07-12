import { cn } from '@ui';
import { type JSX, Show, splitProps } from 'solid-js';
import { useInput } from './context';

export function FormatRibbon(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const input = useInput();
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <Show when={input().showFormatRibbon}>
      <div
        class={cn('flex flex-row w-full gap-2 items-center p-2', local.class)}
        data-input-format-ribbon
        {...rest}
      >
        {local.children}
      </div>
    </Show>
  );
}
