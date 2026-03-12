import { cn } from '@ui/utils/classname';
import { type JSX, splitProps } from 'solid-js';

export function Layout(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div class={cn('flex flex-col w-full p-2', local.class)} {...rest}>
      {local.children}
    </div>
  );
}
