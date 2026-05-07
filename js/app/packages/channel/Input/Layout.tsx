import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui';

export function Layout(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div class={cn('flex flex-col w-full', local.class)} {...rest}>
      {local.children}
    </div>
  );
}
