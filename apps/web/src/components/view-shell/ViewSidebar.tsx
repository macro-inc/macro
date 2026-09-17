import { cn, NavRow, type NavRowProps } from '@ui';
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { ViewSidebarToggle } from './ViewShell';

function Root(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <aside
      {...rest}
      class={cn('flex size-full min-h-0 min-w-0 flex-col', local.class)}
      data-view-sidebar=""
    >
      {local.children}
    </aside>
  );
}

function Header(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'flex h-12 min-w-0 shrink-0 items-center justify-between gap-3 border-b border-edge-muted px-4 py-3',
        local.class
      )}
      data-view-sidebar-header=""
    >
      {local.children}
      <ViewSidebarToggle action="collapse" />
    </div>
  );
}

function Title(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <h1
      {...rest}
      class={cn(
        'min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink',
        local.class
      )}
    >
      {local.children}
    </h1>
  );
}

function Content(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'min-h-0 min-w-0 flex-1 overflow-auto px-1.5 pb-5',
        local.class
      )}
      data-view-sidebar-content=""
    >
      {local.children}
    </div>
  );
}

function Nav(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <nav {...rest} class={cn('flex min-w-0 flex-col gap-1', local.class)}>
      {local.children}
    </nav>
  );
}

function Item(props: NavRowProps) {
  const [local, rest] = splitProps(props, [
    'active',
    'aria-current',
    'class',
    'type',
  ]);
  const ariaCurrent = () => {
    if (local['aria-current'] !== undefined) return local['aria-current'];
    if (local.active) return 'page';
    return undefined;
  };
  return (
    <NavRow
      {...rest}
      type={local.type ?? 'button'}
      active={local.active}
      aria-current={ariaCurrent()}
      class={cn(
        'h-8 gap-2 rounded-xl border-0 px-2.5 py-0 text-sm font-normal transition-none touch:h-11',
        !local.active && 'text-ink-muted',
        local.class
      )}
    />
  );
}

function Icon(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <span
      {...rest}
      aria-hidden="true"
      class={cn(
        'flex size-5 shrink-0 items-center justify-center',
        local.class
      )}
    >
      {local.children}
    </span>
  );
}

export const ViewSidebar = Object.assign(Root, {
  Root,
  Header,
  Title,
  Content,
  Nav,
  Item,
  Icon,
});
