import CaretDownIcon from '@phosphor/caret-down.svg';
import { Button, type ButtonProps, cn } from '@ui';
import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CollapseTransition } from './CollapseTransition';
import { ViewSidebarCloseButton, ViewSidebarToggle } from './ViewShell';

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
        'flex h-12 min-w-0 shrink-0 items-center justify-between gap-3 border-b border-edge-muted py-3 pl-(--sidebar-content-inset) pr-(--sidebar-header-action-inset) [&_[data-split-panel-close]]:ml-(--sidebar-control-overhang)',
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

/** The shared inset between the title bar and a create action or toolbar. */
function Primary(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'min-w-0 px-(--sidebar-gutter) pt-(--sidebar-gutter) touch:pt-[calc(var(--safe-top,0px)+var(--sidebar-gutter))]',
        local.class
      )}
    >
      {local.children}
    </div>
  );
}

/** A row of controls whose last button sits on the right icon rail. */
function Toolbar(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'flex h-(--sidebar-row-height) min-w-0 items-center justify-between gap-2 pl-(--sidebar-item-inset) pr-(--sidebar-action-inset)',
        local.class
      )}
    >
      {local.children}
    </div>
  );
}

function Control(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      {...rest}
      class={cn(
        'size-(--sidebar-control-size) shrink-0 rounded-lg',
        local.class
      )}
      data-view-sidebar-control=""
    />
  );
}

function Content(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col gap-(--sidebar-section-gap) overflow-auto px-(--sidebar-gutter) py-(--sidebar-content-inset)',
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
      class={cn(
        'flex min-w-0 shrink-0 flex-col gap-(--sidebar-row-gap)',
        local.class
      )}
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
        'flex h-(--sidebar-row-height) w-full min-w-0 shrink-0 items-center justify-start gap-(--sidebar-label-gap) rounded-lg border-0 px-(--sidebar-item-inset) py-0 text-left text-sm leading-5 font-normal transition-none touch:h-11',
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
      data-view-sidebar-icon=""
      class={cn(
        'flex size-(--sidebar-icon-slot) shrink-0 items-center justify-center [&>svg]:size-(--sidebar-icon-size)',
        local.class
      )}
    >
      {local.children}
    </span>
  );
}

/** Non-interactive trailing glyphs use the same rail as trailing buttons. */
function Trailing(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <span
      {...rest}
      aria-hidden="true"
      class={cn(
        'ml-auto flex size-(--sidebar-icon-slot) shrink-0 items-center justify-center',
        local.class
      )}
      data-view-sidebar-trailing=""
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
        <span class="absolute right-(--sidebar-action-inset) top-1/2 flex -translate-y-1/2">
          <Control
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
          </Control>
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
          'relative min-w-0 pl-(--sidebar-icon-slot) before:pointer-events-none before:absolute before:inset-y-0 before:left-(--sidebar-local-rail) before:w-px before:-translate-x-1/2 before:bg-edge-muted',
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
        'flex h-(--sidebar-row-height) w-full min-w-0 shrink-0 items-center gap-(--sidebar-label-gap) rounded-lg bg-hover px-(--sidebar-item-inset) text-left text-sm leading-5 font-medium text-ink hover:bg-active focus-visible:outline-2 focus-visible:outline-accent touch:h-11',
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
      class={cn(
        'shrink-0 border-t border-edge-muted px-(--sidebar-gutter) py-3',
        local.class
      )}
    >
      {local.children}
    </div>
  );
}

export const ViewSidebar = Object.assign(Root, {
  Root,
  Header,
  CloseButton: ViewSidebarCloseButton,
  Title,
  Primary,
  Toolbar,
  Control,
  Content,
  Nav,
  Item,
  Icon,
  Trailing,
  TreeItem,
  Branch,
  Action,
  Footer,
});
