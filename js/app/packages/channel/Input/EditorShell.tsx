import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui';

export function EditorShell(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn(
        'transition-all duration-150 px-3 pt-2 pb-2 @min-[40rem]:pb-4 overflow-y-auto placeholder:text-ink-placeholder text-ink w-full text-sm',
        local.class
      )}
      data-input-editor-shell
      {...rest}
    >
      {local.children}
    </div>
  );
}
