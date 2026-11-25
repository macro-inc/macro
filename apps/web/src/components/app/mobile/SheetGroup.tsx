import { cn } from '@ui';
import { type ParentProps, splitProps } from 'solid-js';

export type SheetGroupProps = ParentProps<{
  class?: string;
  'aria-label'?: string;
}>;

/** A filled group in a scrolling phone sheet. */
export function SheetGroup(props: SheetGroupProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <section class={cn('rounded-3xl bg-panel p-1', local.class)} {...rest}>
      {local.children}
    </section>
  );
}
