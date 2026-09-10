import { cn, NavRow, type NavRowProps } from '@ui';
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';

function Root(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <aside
      {...rest}
      class={cn(
        'flex size-full min-h-0 min-w-0 flex-col border-r border-edge px-4 pb-5 pt-4',
        local.class
      )}
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
        'flex min-w-0 shrink-0 items-center justify-between gap-3',
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
        'min-w-0 truncate text-2xl font-semibold tracking-[-0.03em] text-ink',
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
      class={cn('min-h-0 min-w-0 flex-1 overflow-auto', local.class)}
      data-view-sidebar-content=""
    >
      {local.children}
    </div>
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
      class={cn(
        'h-9 gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-muted not-disabled:hover:bg-hover not-disabled:hover:text-ink',
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
  Nav,
  Item,
});
