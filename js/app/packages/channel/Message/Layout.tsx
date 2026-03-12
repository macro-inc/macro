import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

type LayoutProps = JSX.HTMLAttributes<HTMLDivElement> & {
  editing?: boolean;
};

export function Layout(props: LayoutProps) {
  const [local, rest] = splitProps(props, ['class', 'children', 'editing']);

  return (
    <div
      class={cn('w-full p-2', local.class)}
      data-message-layout
      {...rest}
    >
      <div
        class="grid min-w-0 items-start gap-x-2"
        style={{
          'grid-template-columns': 'var(--user-icon-width) minmax(0, 1fr) auto',
          'grid-template-areas': `"icon header actions" "icon body actions"`,
        }}
      >
        <div
          class={cn('contents [&_[data-message-slot=body]]:mt-0.5', {
            '[&_[data-message-slot=body]]:mt-2': local.editing,
          })}
        >
          {local.children}
        </div>
      </div>
    </div>
  );
}
