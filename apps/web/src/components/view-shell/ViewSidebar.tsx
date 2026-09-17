import CaretDownIcon from '@phosphor/caret-down.svg';
import { Button, cn } from '@ui';
import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CollapseTransition } from './CollapseTransition';
import { ViewSidebarToggle } from './ViewShell';

function Root(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <aside
      {...rest}
      class={cn(
        'flex size-full min-h-0 min-w-0 flex-col bg-panel',
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
      class={cn('min-w-0 truncate text-sm font-semibold text-ink', local.class)}
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
        'flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-auto px-2 py-4',
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
    <nav
      {...rest}
      class={cn('flex min-w-0 shrink-0 flex-col gap-0.5', local.class)}
    >
      {local.children}
    </nav>
  );
}

function Item(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    as?: 'div';
  }
) {
  const [local, rest] = splitProps(props, [
    'as',
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
    <Dynamic
      component={local.as ?? 'button'}
      {...rest}
      type={local.type ?? 'button'}
      aria-current={ariaCurrent()}
      class={cn(
        'flex h-9 w-full min-w-0 shrink-0 items-center justify-start gap-2.5 rounded-lg border-0 px-2 py-0 text-left text-sm leading-5 font-normal transition-none touch:h-11',
        'outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50',
        local.active
          ? 'bg-active text-ink'
          : 'text-ink-muted not-disabled:hover:bg-hover not-disabled:hover:text-ink',
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

/** A tree destination with a separate disclosure action in the trailing lane. */
function TreeItem(props: {
  active?: boolean;
  expanded?: boolean;
  label: string;
  onToggle: () => void;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <div class="relative min-w-0">
      <Item
        active={props.active}
        title={props.label}
        onClick={props.onClick}
        class="pr-9"
      >
        {props.children}
      </Item>
      <Show when={props.expanded !== undefined}>
        <span class="absolute right-1 top-1/2 flex -translate-y-1/2">
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-7 rounded-md"
            label={`${props.expanded ? 'Collapse' : 'Expand'} ${props.label}`}
            aria-expanded={props.expanded}
            onClick={props.onToggle}
          >
            <CaretDownIcon
              class={cn(
                'size-3 transition-transform -rotate-90',
                props.expanded && 'rotate-0'
              )}
            />
          </Button>
        </span>
      </Show>
    </div>
  );
}

/** Indent children one icon slot, with the rail centered under the parent icon. */
function Branch(
  props: JSX.HTMLAttributes<HTMLDivElement> & { open?: boolean }
) {
  const [local, rest] = splitProps(props, ['children', 'class', 'open']);
  return (
    <CollapseTransition open={local.open ?? true}>
      <div
        {...rest}
        class={cn(
          'relative min-w-0 pl-5 before:pointer-events-none before:absolute before:inset-y-0 before:left-4.5 before:w-px before:-translate-x-1/2 before:bg-edge-muted',
          local.class
        )}
        data-view-sidebar-branch=""
      >
        {local.children}
      </div>
    </CollapseTransition>
  );
}

/** Shared create surface, also usable as a menu trigger. */
function Action(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <button
      type="button"
      {...rest}
      class={cn(
        'flex h-9 w-full min-w-0 shrink-0 items-center gap-2.5 rounded-lg bg-hover px-2 text-left text-sm leading-5 font-medium text-ink hover:bg-active focus-visible:outline-2 focus-visible:outline-accent touch:h-11',
        local.class
      )}
    >
      {local.children}
    </button>
  );
}

function Footer(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn('shrink-0 border-t border-edge-muted px-2 py-3', local.class)}
    >
      {local.children}
    </div>
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
  TreeItem,
  Branch,
  Action,
  Footer,
});
