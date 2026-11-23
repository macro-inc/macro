import { SplitHeaderContextMenu } from '@components/app/split-layout/components/SplitHeaderContextMenu';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { callHandler } from '@kobalte/utils';
import { mergeRefs } from '@solid-primitives/refs';
import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { Button, type ButtonProps, cn } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import type { Component, JSX } from 'solid-js';
import {
  createContext,
  createSignal,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useChosenDestination } from './chosen-destination';
import { useListSearchKeys } from './list-search-keys';
import { SearchBar } from './SearchBar';
import { SidebarSection } from './SidebarSection';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import { SidebarSections } from './SidebarSections';
import {
  ViewSidebarCloseButton,
  ViewSidebarToggle,
} from './ViewNavigationControls';
import { ViewShellContext } from './view-shell-context';

const SidebarViewContext = createContext<{ view: () => string | undefined }>();

function Root(props: JSX.HTMLAttributes<HTMLElement> & { reorderId?: string }) {
  const [local, rest] = splitProps(props, ['children', 'class', 'reorderId']);
  // A destination chosen here before the tabs of the view it opens mount
  // still leaves the keyboard on that view.
  useChosenDestination();
  return (
    <SidebarViewContext.Provider value={{ view: () => local.reorderId }}>
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
    </SidebarViewContext.Provider>
  );
}

type SearchControls = {
  /** Collapses the header's search field. */
  close: () => void;
  /** The header button that opens the field. */
  button: () => HTMLElement | undefined;
};

const SearchControlsContext = createContext<SearchControls>();

function Header(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    search?: () => JSX.Element;
    searchLabel?: string;
    searchOpen?: boolean;
    onSearchOpenChange?: (open: boolean) => void;
    /** View controls (e.g. filters) in the right group, before search. */
    actions?: JSX.Element;
    collapseControl?: JSX.Element;
  }
) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'actions',
    'search',
    'searchLabel',
    'searchOpen',
    'onSearchOpenChange',
    'collapseControl',
  ]);
  const ws = useContext(ViewShellContext);
  // A sidebar docked beside touch content is that view's list, as on a phone,
  // which has no header; sheets and overlays keep theirs.
  const dockedOnTouch = () =>
    isTouchDevice() && !!ws && !ws.aside.isSheet() && !ws.aside.isOverlay();
  const [open, setOpen] = createSignal(false);
  const searchOpen = () => local.searchOpen ?? open();
  let searchArea: HTMLDivElement | undefined;
  let searchButton: HTMLButtonElement | undefined;
  const closeSearch = () => {
    setOpen(false);
    local.onSearchOpenChange?.(false);
  };
  const toggleSearch = () => {
    const next = !searchOpen();
    setOpen(next);
    local.onSearchOpenChange?.(next);
    if (next)
      queueMicrotask(() =>
        searchArea
          ?.querySelector<HTMLElement>('input, [contenteditable="true"]')
          ?.focus()
      );
  };
  return (
    <Show
      when={!dockedOnTouch()}
      fallback={<div aria-hidden="true" class="h-(--safe-top) shrink-0" />}
    >
      <SplitHeaderContextMenu>
        <div
          {...rest}
          class={cn(
            'flex h-12 min-w-0 shrink-0 items-center justify-between gap-3 py-3 pl-(--sidebar-content-inset) pr-(--sidebar-header-action-inset) touch:h-[calc(var(--safe-top,0px)+3rem)] touch:pb-0 touch:pt-(--safe-top) [&_[data-split-panel-close]]:ml-(--sidebar-control-overhang)',
            local.class
          )}
          data-view-sidebar-header=""
        >
          <div class="min-w-0 flex-1">{local.children}</div>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            {local.actions}
            <Show when={!isTouchDevice() && local.search}>
              <Control
                ref={searchButton}
                aria-label={local.searchLabel ?? 'Search'}
                aria-expanded={searchOpen()}
                onClick={toggleSearch}
              >
                <SearchIcon class="size-4" />
              </Control>
            </Show>
            {local.collapseControl ?? <ViewSidebarToggle action="collapse" />}
          </div>
        </div>
      </SplitHeaderContextMenu>
      <Show when={!isTouchDevice() && searchOpen()}>
        <div
          ref={searchArea}
          class="min-w-0 px-(--sidebar-gutter) pt-(--sidebar-gutter)"
          style={{ '--view-search-height': 'var(--sidebar-row-height)' }}
          data-sidebar-search=""
        >
          <SearchControlsContext.Provider
            value={{ close: closeSearch, button: () => searchButton }}
          >
            {local.search?.()}
          </SearchControlsContext.Provider>
        </div>
      </Show>
    </Show>
  );
}

/**
 * The search field of a sidebar that is the list it searches (Home, Chat,
 * Agents), in its header's search slot. It keeps the list search keys of
 * `ListHeaderSearch`: ArrowDown or Enter moves to the first result, Escape
 * leaves the field with the search, and Escape in the list clears it. An
 * empty field collapses back to the header's search button.
 */
function Search(props: {
  label: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Moves keyboard focus into the sidebar's result list. */
  focusResults?: () => void;
  /** Whether that list has a row; see `ListSearchKeysOptions.hasResults`. */
  hasResults?: () => boolean;
  hotkey?: string;
  ref?: (element: HTMLInputElement) => void;
}) {
  const header = useContext(SearchControlsContext);
  let input: HTMLInputElement | undefined;
  const keys = useListSearchKeys({
    value: () => props.value,
    clear: () => {
      props.onValueChange('');
      header?.close();
    },
    focusResults: () => props.focusResults,
    hasResults: props.hasResults,
    input: () => input,
    trigger: () => header?.button(),
    // The preview or conversation beside the sidebar keeps its own Escape.
    ownsEscape: () =>
      input
        ?.closest('[data-view-shell-aside]')
        ?.contains(document.activeElement) ?? false,
  });

  return (
    <SearchBar
      ref={mergeRefs((element) => (input = element), props.ref)}
      label={props.label}
      placeholder={props.placeholder ?? props.label}
      value={props.value}
      onValueChange={props.onValueChange}
      hotkey={props.hotkey}
      // The browser's own history popup would take ArrowDown and Enter.
      autocomplete="off"
      onKeyDown={keys.onKeyDown}
      onEscape={keys.onEscape}
    />
  );
}

export type ViewSwitcherProps = {
  /** The view or section name; clicking it opens the menu. */
  children: JSX.Element;
  /** Shown beside navigation titles; collapsed headers show the name only. */
  caret?: boolean;
  /** Rendered instead where the menu is unavailable (touch, popovers). */
  fallback?: JSX.Element;
};

/**
 * The app's view switcher. The app chrome supplies it so this shell stays
 * independent of the app's navigation.
 */
export const ViewSwitcherContext =
  createContext<Component<ViewSwitcherProps>>();

/** A view name that opens the view switcher, or plain text without one. */
export function ViewSwitchTrigger(props: ViewSwitcherProps) {
  const ViewSwitcher = useContext(ViewSwitcherContext);
  if (!ViewSwitcher) return <>{props.fallback ?? props.children}</>;
  return <ViewSwitcher {...props} />;
}

function Title(
  props: JSX.HTMLAttributes<HTMLHeadingElement> & {
    /** Navigation titles show a caret; collapsed headers omit it. */
    caret?: boolean;
  }
) {
  const [local, rest] = splitProps(props, ['caret', 'children', 'class']);
  return (
    <h1
      {...rest}
      class={cn(
        'flex min-w-0 max-w-full flex-1 items-center text-sm font-semibold tracking-[-0.03em] text-ink',
        local.class
      )}
    >
      <ViewSwitchTrigger
        caret={local.caret ?? true}
        fallback={<span class="truncate">{local.children}</span>}
      >
        {local.children}
      </ViewSwitchTrigger>
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
        'min-w-0 px-(--sidebar-gutter) pt-(--sidebar-gutter)',
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
      size="icon-xs"
      {...rest}
      class={cn('shrink-0', local.class)}
      data-view-sidebar-control=""
    />
  );
}

function Content(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class', 'ref']);
  const view = useContext(SidebarViewContext);
  const dnd = useDragDropContext();
  let viewport: HTMLDivElement | undefined;
  return (
    <div
      ref={mergeRefs(local.ref, (element) => {
        viewport = element;
      })}
      {...rest}
      class={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col gap-(--sidebar-section-gap) overflow-auto px-(--sidebar-gutter) py-(--sidebar-content-inset)',
        local.class
      )}
      data-view-sidebar-content=""
    >
      <Show when={dnd && view?.view()} fallback={local.children}>
        {(id) => (
          <SidebarSections view={id()} viewport={() => viewport}>
            {local.children}
          </SidebarSections>
        )}
      </Show>
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
    'onClick',
  ]);
  const shell = useContext(ViewShellContext);
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
      data-view-sidebar-item=""
      onClick={(
        event: MouseEvent & {
          currentTarget: HTMLButtonElement;
          target: Element;
        }
      ) => {
        callHandler(event, local.onClick);
        if (!event.defaultPrevented && shell?.aside.isSheet())
          shell.aside.collapse();
      }}
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
        class="pr-9 touch:pr-12"
      >
        {props.children}
      </Item>
      <Show when={props.expanded !== undefined}>
        <span class="absolute right-(--sidebar-action-inset) top-1/2 flex -translate-y-1/2">
          <Control
            class="rounded-md"
            aria-label={`${props.expanded ? 'Collapse' : 'Expand'} ${props.label}`}
            aria-expanded={props.expanded}
            onClick={props.onToggle}
          >
            <CaretDownIcon
              class={cn(
                'size-3 touch:size-4 transition-transform -rotate-90',
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
          'relative min-w-0 pl-(--sidebar-icon-slot) before:pointer-events-none before:absolute before:inset-y-0 before:left-(--sidebar-local-rail) before:w-px before:-translate-x-1/2 before:bg-edge-divider',
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
    <Button
      variant="secondary"
      type="button"
      {...rest}
      class={cn(
        'h-(--sidebar-row-height) w-full min-w-0 justify-start gap-(--sidebar-label-gap) px-(--sidebar-item-inset) text-left touch:h-11',
        local.class
      )}
    >
      {local.children}
    </Button>
  );
}

function Footer(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'shrink-0 border-t border-edge-frame px-(--sidebar-gutter) py-3',
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
  Toggle: ViewSidebarToggle,
  Search,
  CloseButton: ViewSidebarCloseButton,
  Title,
  Primary,
  Toolbar,
  Control,
  Content,
  Nav,
  Section: SidebarSection,
  SectionHeader: SidebarSectionHeader,
  Item,
  Icon,
  Trailing,
  TreeItem,
  Branch,
  Action,
  Footer,
});
