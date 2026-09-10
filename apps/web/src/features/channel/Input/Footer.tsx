import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';

export function Footer(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn(
        'flex flex-row w-full justify-between items-center gap-2 px-2 pb-2 touch:h-8 touch:p-2 touch:mb-2',
        local.class
      )}
      data-input-footer
      {...rest}
    >
      {local.children}
    </div>
  );
}
