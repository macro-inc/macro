import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';

export function EditorShell(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn(
        'transition-all duration-150 overflow-y-auto placeholder:text-ink-placeholder text-ink w-full text-sm not-touch:max-h-[225px]',
        'px-4 touch:px-3 py-2 touch:@min-[40rem]:pb-4 not-touch:px-[9.375px] not-touch:py-[4.6875px]',
        local.class
      )}
      data-input-editor-shell
      {...rest}
    >
      {local.children}
    </div>
  );
}
