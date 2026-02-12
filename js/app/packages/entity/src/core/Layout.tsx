import { cn } from '@ui/utils/classname';
import { type JSX, splitProps } from 'solid-js';
import '../index.css';

export function Layout(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div class={cn('entity-layout', local.class)} {...rest}>
      {local.children}
    </div>
  );
}
