import { isTouchDevice } from '@core/mobile/isTouchDevice';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import { Button, cn, Layer } from '@ui';
import {
  type Accessor,
  children,
  createContext,
  createSignal,
  createUniqueId,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import { SidebarCreatePresentation } from './SidebarCreateAction';
import { ViewSidebar } from './ViewSidebar';

type SidebarActions = {
  title: Accessor<string | undefined>;
  search: Accessor<JSX.Element>;
  create: Accessor<JSX.Element>;
  sidebarCreate: Accessor<JSX.Element>;
  hasCreate: Accessor<boolean>;
  onSearch?: () => void;
};
const SidebarActionsContext = createContext<{
  revealSearch: () => void;
  searchOpen: Accessor<boolean>;
  setSearchOpen: Setter<boolean>;
  active: Accessor<SidebarActions | undefined>;
  setActive: Setter<SidebarActions | undefined>;
  base: Accessor<SidebarActions | undefined>;
  setBase: Setter<SidebarActions | undefined>;
}>();

export function SidebarActionsProvider(
  props: ParentProps<{ revealSearch?: () => void }>
) {
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [active, setActive] = createSignal<SidebarActions>();
  const [base, setBase] = createSignal<SidebarActions>();
  return (
    <SidebarActionsContext.Provider
      value={{
        revealSearch: () => {
          props.revealSearch?.();
          setSearchOpen(true);
        },
        searchOpen,
        setSearchOpen,
        active,
        setActive,
        base,
        setBase,
      }}
    >
      {props.children}
    </SidebarActionsContext.Provider>
  );
}

/** Reveal navigation before focusing its scoped search field. */
export function useSidebarSearchFocus(
  input: () => HTMLInputElement | undefined
) {
  const context = useContext(SidebarActionsContext);
  return () => {
    context?.revealSearch();
    queueMicrotask(() => {
      input()?.focus();
      input()?.select();
    });
  };
}

/** Title left; view tools and creation grouped on the right. */
export function WorkspaceActions(
  props: ParentProps<{ controls?: JSX.Element }>
) {
  const context = useContext(SidebarActionsContext);
  const entry = () => context?.active() ?? context?.base();
  return (
    <div
      data-workspace-toolbar=""
      class="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
    >
      <div
        data-workspace-leading=""
        class="flex min-w-0 items-center gap-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:leading-7 [&_h1]:tracking-[-0.025em] [&_[aria-current=page]]:h-auto [&_[aria-current=page]]:text-xl [&_[aria-current=page]]:font-semibold [&_[aria-current=page]]:leading-7 [&_[aria-current=page]]:tracking-[-0.025em]"
      >
        {props.children}
      </div>
      <div class="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
        <div
          data-workspace-controls=""
          class="flex min-w-0 items-center gap-1 empty:hidden"
        >
          {props.controls}
        </div>
        <Show when={entry()}>
          <Show when={entry()?.hasCreate()}>
            <div data-workspace-create="" class="shrink-0">
              {entry()?.create()}
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/** A subview can supply its own search/create pair without moving their location. */
export function SidebarActionOverride(props: {
  title?: string;
  search: JSX.Element;
  create?: () => JSX.Element;
  sidebarCreate?: () => JSX.Element;
  onSearch?: () => void;
}) {
  const context = useContext(SidebarActionsContext);
  const entry = {
    title: () => props.title,
    onSearch: props.onSearch,
    search: children(() => props.search),
    hasCreate: () => !!props.create,
    create: children(() => props.create?.()),
    sidebarCreate: children(() => (
      <SidebarCreatePresentation.Provider
        value={() => props.title ?? context?.base()?.title() ?? 'New'}
      >
        {(props.sidebarCreate ?? props.create)?.()}
      </SidebarCreatePresentation.Provider>
    )),
  };
  if (!context)
    return (
      <div class="flex min-w-0 items-center gap-2">
        {entry.search()}
        {entry.create()}
      </div>
    );
  onMount(() => context.setActive(entry));
  onCleanup(() =>
    context.setActive((active) => (active === entry ? undefined : active))
  );
  return null;
}

/** Stable home for a workspace title and its search and creation controls. */
export function SidebarActionRow(props: {
  title: string;
  search: JSX.Element;
  create?: () => JSX.Element;
  sidebarCreate?: () => JSX.Element;
  onSearch?: () => void;
  class?: string;
  actions?: JSX.Element;
  titleActions?: JSX.Element;
}) {
  const context = useContext(SidebarActionsContext);

  const entry = {
    title: () => props.title,
    onSearch: props.onSearch,
    search: children(() => props.search),
    hasCreate: () => !!props.create,
    create: children(() => props.create?.()),
    sidebarCreate: children(() => (
      <SidebarCreatePresentation.Provider
        value={() => props.title ?? context?.base()?.title() ?? 'New'}
      >
        {(props.sidebarCreate ?? props.create)?.()}
      </SidebarCreatePresentation.Provider>
    )),
  };
  onMount(() => context?.setBase(entry));
  onCleanup(() =>
    context?.setBase((base) => (base === entry ? undefined : base))
  );

  const current = () => context?.active() ?? entry;
  const [localSearchOpen, setLocalSearchOpen] = createSignal(false);
  const searchOpen = context?.searchOpen ?? localSearchOpen;
  const setSearchOpen = context?.setSearchOpen ?? setLocalSearchOpen;
  const searchId = createUniqueId();
  let searchRow: HTMLDivElement | undefined;
  let searchButton: HTMLButtonElement | undefined;
  const openSearch = () => {
    setSearchOpen(true);
    current().onSearch?.();
    queueMicrotask(() => {
      const input = searchRow?.querySelector('input');
      input?.focus();
      input?.select();
    });
  };

  return (
    <>
      <ViewSidebar.Header
        class={cn(
          'h-12 gap-2 py-1',
          current().hasCreate() && 'pl-(--sidebar-gutter)',
          props.class
        )}
      >
        <ViewSidebar.Title class={current().hasCreate() ? 'sr-only' : 'flex-1'}>
          {current().title() ?? props.title}
        </ViewSidebar.Title>
        <Show when={current().hasCreate()}>
          <div
            data-sidebar-create-area=""
            class="mr-auto shrink-0"
            role="group"
            aria-label={`Create in ${current().title() ?? props.title}`}
          >
            <Layer depth={0}>{current().sidebarCreate()}</Layer>
          </div>
        </Show>
        {props.titleActions}
        {props.actions}
        <Button
          ref={searchButton}
          variant="ghost"
          size="icon-sm"
          label={`Search ${current().title() ?? props.title}`}
          aria-expanded={searchOpen()}
          aria-controls={searchId}
          onClick={openSearch}
        >
          <MagnifyingGlassIcon class="size-4" />
        </Button>
        <Show when={!isTouchDevice()}>
          <ViewSidebar.CloseButton class="shrink-0" />
        </Show>
      </ViewSidebar.Header>
      <div
        ref={searchRow}
        id={searchId}
        hidden={!searchOpen()}
        data-sidebar-search=""
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          setSearchOpen(false);
          searchButton?.focus();
        }}
        class="min-w-0 shrink-0 px-(--sidebar-gutter) pt-2 pb-2 [&_[data-search-bar]]:h-10 [&_[data-search-bar]]:w-full [&_[data-search-bar]]:rounded-full [&_[data-search-bar]]:border-0 [&_[data-search-bar]]:bg-ink/5 [&_[data-search-bar]]:shadow-none"
        onFocusIn={(event) => {
          if (event.target instanceof HTMLInputElement) current().onSearch?.();
        }}
      >
        {current().search()}
      </div>
    </>
  );
}
