import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui';

export function Footer(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn(
        'flex flex-row w-full h-8 justify-between items-center p-2 mb-2 space-x-2',
        local.class
      )}
      data-input-footer
      {...rest}
    >
      {local.children}
    </div>
  );
}
