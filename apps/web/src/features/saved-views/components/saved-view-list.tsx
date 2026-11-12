import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  ContextMenuContent,
  ContextMenuTrigger,
} from '@core/component/ContextMenu';
import CheckIcon from '@icon/system/regular/check.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import BookmarkIcon from '@phosphor/bookmark-simple.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import PlusIcon from '@phosphor/plus.svg';
import UsersIcon from '@phosphor/users.svg';
import { Dropdown } from '@ui';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import type { SavedView } from '../core/saved-view';

function Root(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <CollapsibleSection.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      {props.children}
    </CollapsibleSection.Root>
  );
}

function Header(props: {
  onCreate?: () => void;
  createButtonRef?: (element: HTMLButtonElement) => void;
}) {
  return (
    <CollapsibleSection.Header>
      <CollapsibleSection.Trigger>
        <span class="min-w-0 truncate">{t('viewMenus.savedViews')}</span>
        <CollapsibleSection.Indicator />
      </CollapsibleSection.Trigger>
      <Show when={props.onCreate}>
        {(onCreate) => (
          <CollapsibleSection.Action
            ref={props.createButtonRef}
            aria-label={t('viewMenus.newSavedView')}
            tooltip={t('viewMenus.newSavedView')}
            onClick={onCreate()}
          >
            <PlusIcon class="size-3.5" />
          </CollapsibleSection.Action>
        )}
      </Show>
    </CollapsibleSection.Header>
  );
}

function Content(props: { children: JSX.Element }) {
  return (
    <CollapsibleSection.Content>{props.children}</CollapsibleSection.Content>
  );
}

function Items(props: {
  label: string;
  ref?: (element: HTMLElement) => void;
  children: JSX.Element;
  mobile?: boolean;
}) {
  return props.mobile ? (
    <MobileDrawer.Section aria-label={props.label} class="mx-0">
      {props.children}
    </MobileDrawer.Section>
  ) : (
    <ViewSidebar.Nav ref={props.ref} aria-label={props.label} class="relative">
      {props.children}
    </ViewSidebar.Nav>
  );
}

function Draft(props: { onSelect: () => void; mobile?: boolean }) {
  return (
    <Show
      when={props.mobile}
      fallback={
        <ViewSidebar.Item
          active
          onClick={props.onSelect}
          title={t('viewMenus.newViewDraft')}
          aria-label={t('viewMenus.newViewDraft')}
        >
          <ViewSidebar.Icon>
            <BookmarkIcon class="size-4" />
          </ViewSidebar.Icon>
          <span class="truncate italic">{t('viewMenus.newView')}</span>
          <span class="ml-auto text-xs text-ink-muted">
            {t('viewMenus.draft')}
          </span>
        </ViewSidebar.Item>
      }
    >
      <MobileDrawer.Item onClick={props.onSelect} class="h-12 text-accent">
        <BookmarkIcon class="size-5 shrink-0" />
        <span class="min-w-0 flex-1 truncate italic">
          {t('viewMenus.newView')}
        </span>
        <span class="text-xs">{t('viewMenus.draft')}</span>
      </MobileDrawer.Item>
    </Show>
  );
}

export const SavedViewList = { Root, Header, Content, Items, Draft };

/** Drag wiring a consumer supplies when its list can be reordered. */
export type SavedViewRowReorder = {
  ref: (element: HTMLElement) => void;
  onMouseDown: (event: MouseEvent) => void;
  dragging: () => boolean;
};

/** A row accepts its consumer's menus without owning CRUD or viewer state. */
export function SavedViewListRow(props: {
  view: SavedView;
  selected: boolean;
  onSelect: () => void;
  scopeKey: string | undefined;
  menu: (defer: (action: () => void) => void) => JSX.Element;
  reorder?: SavedViewRowReorder;
  /** Status beside the name, such as an unread marker. */
  trailing?: JSX.Element;
  /** Spoken with the name, since the trailing status is decorative. */
  statusLabel?: string;
  mobile?: boolean;
}) {
  const [menuAnchor, setMenuAnchor] = createSignal<HTMLElement>();
  let pending: { scopeKey: string | undefined; run: () => void } | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    pending = undefined;
  });
  const defer = (run: () => void) => {
    pending = { scopeKey: props.scopeKey, run };
  };
  const finishMenuClose = (event: Event) => {
    const action = pending;
    pending = undefined;
    if (!action) return;
    event.preventDefault();
    queueMicrotask(() => {
      if (disposed || action.scopeKey !== props.scopeKey) return;
      menuAnchor()
        ?.querySelector<HTMLElement>('button')
        ?.focus({ preventScroll: true });
      action.run();
    });
  };
  const label = () => {
    const name = props.view.sharedTeamId
      ? t('viewMenus.sharedWithTeam', { name: props.view.name })
      : props.view.name;
    return props.statusLabel
      ? t('viewMenus.savedViewWithStatus', { name, status: props.statusLabel })
      : name;
  };
  const hasTrailing = () => Boolean(props.view.sharedTeamId || props.trailing);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="div"
        ref={(element: HTMLElement) => {
          setMenuAnchor(element);
          props.reorder?.ref(element);
        }}
        class="group relative min-w-0"
        classList={{ 'opacity-40': props.reorder?.dragging() }}
        onMouseDown={props.reorder?.onMouseDown}
      >
        <Show
          when={props.mobile}
          fallback={
            <ViewSidebar.Item
              active={props.selected}
              onClick={props.onSelect}
              class={hasTrailing() ? 'pr-15' : 'pr-10'}
              title={label()}
              aria-label={label()}
            >
              <ViewSidebar.Icon>
                <BookmarkIcon class="size-4" />
              </ViewSidebar.Icon>
              <span class="truncate">{props.view.name}</span>
            </ViewSidebar.Item>
          }
        >
          <MobileDrawer.Item
            aria-current={props.selected ? 'page' : undefined}
            aria-label={label()}
            title={label()}
            onClick={props.onSelect}
            class="h-12 gap-3 pr-24 text-base aria-[current=page]:bg-accent/15 aria-[current=page]:text-accent"
          >
            <BookmarkIcon class="size-5 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{props.view.name}</span>
            <Show when={props.selected}>
              <CheckIcon class="size-5 shrink-0" />
            </Show>
          </MobileDrawer.Item>
        </Show>
        {/* The actions sit before the status, which keeps the icon rail. */}
        <div
          class="pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-0.5"
          classList={{
            'right-3': props.mobile,
            'right-(--sidebar-item-inset)': !props.mobile && hasTrailing(),
            'right-(--sidebar-action-inset)': !props.mobile && !hasTrailing(),
          }}
        >
          {/* Hover reveals the actions; keyboard focus and an open menu keep them. */}
          <div
            class={
              props.mobile
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-auto opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 has-[[data-expanded]]:opacity-100 touch:opacity-100'
            }
          >
            <Dropdown placement="bottom-end">
              <Dropdown.Trigger
                as={ViewSidebar.Control}
                aria-label={t('viewMenus.viewActions', {
                  name: props.view.name,
                })}
                tooltip={t('viewMenus.viewActions', { name: props.view.name })}
              >
                <DotsIcon class="size-4" />
              </Dropdown.Trigger>
              <Dropdown.Content
                class="min-w-44"
                portalScope="local"
                onCloseAutoFocus={finishMenuClose}
              >
                {props.menu(defer)}
              </Dropdown.Content>
            </Dropdown>
          </div>
          <Show when={hasTrailing() && !props.mobile}>
            <ViewSidebar.Trailing>
              {props.trailing}
              <Show when={props.view.sharedTeamId}>
                <UsersIcon class="size-3.5" />
              </Show>
            </ViewSidebar.Trailing>
          </Show>
        </div>
        <Show when={props.mobile && props.view.sharedTeamId}>
          <UsersIcon class="pointer-events-none absolute right-12 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        </Show>
      </ContextMenuTrigger>
      <ContextMenu.Portal
        mount={menuAnchor()?.closest<HTMLElement>('.portal-scope') ?? undefined}
      >
        <ContextMenuContent
          class="min-w-44 p-0"
          onCloseAutoFocus={finishMenuClose}
        >
          {props.menu(defer)}
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
