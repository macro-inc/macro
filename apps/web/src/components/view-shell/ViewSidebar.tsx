import { cn, NavRow, type NavRowProps } from '@ui';
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';

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
      class={cn('min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-5', local.class)}
      data-view-sidebar-content=""
    >
      {local.children}
    </div>
  );
}

function CompactContent(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Content
      {...rest}
      class={cn(
        'px-1.5 [&_nav]:gap-1 [&_[data-view-sidebar-item]]:border-0 [&_[data-view-sidebar-item]:hover]:bg-none [&_[data-view-sidebar-item]]:h-8 [&_[data-view-sidebar-item]]:gap-2 [&_[data-view-sidebar-item]]:px-2.5 [&_[data-view-sidebar-item]]:py-0 [&_[data-view-sidebar-item]]:font-normal [&_[data-view-sidebar-item]>span[aria-hidden]]:size-5 touch:[&_[data-view-sidebar-item]]:h-11',
        local.class
      )}
    />
  );
}

function Nav(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <nav {...rest} class={cn('flex min-w-0 flex-col gap-0.5', local.class)}>
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
      data-view-sidebar-item=""
      class={cn(
        'h-9 gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-muted transition-none not-disabled:hover:bg-hover not-disabled:hover:text-ink',
        local.active && 'bg-active text-ink not-disabled:hover:bg-active',
        local.class
      )}
    />
  );
}

export const ViewSidebar = Object.assign(Root, {
  Root,
  Header,
  Title,
  Content,
  CompactContent,
  Nav,
  Item,
});
