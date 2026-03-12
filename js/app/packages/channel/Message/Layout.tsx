import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

export function Layout(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div class={cn('w-full p-2', local.class)} data-message-layout {...rest}>
      <div
        class="grid min-w-0 items-start gap-x-2"
        style={{
          'grid-template-columns': 'var(--user-icon-width) minmax(0, 1fr) auto',
          'grid-template-areas':
            '"icon header actions" "icon content actions" "icon footer actions"',
        }}
      >
        <div class="contents">{local.children}</div>
      </div>
    </div>
  );
}
