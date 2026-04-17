import { cn } from '@ui/utils/classname';
import { type JSX, splitProps } from 'solid-js';

export function Layout(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('w-full pr-2 pl-(--message-padding-x)', local.class)}
      data-message-layout
      {...rest}
    >
      <div
        class="grid min-w-0 items-start gap-x-2"
        style={{
          'grid-template-columns': 'var(--user-icon-width) minmax(0, 1fr)',
          'grid-template-areas': '"icon header" "icon content" "icon footer"',
        }}
      >
        <div class="contents">{local.children}</div>
      </div>
    </div>
  );
}
