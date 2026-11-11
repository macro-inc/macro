import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import {
  ContextMenuContent,
  ContextMenuTrigger,
} from '@core/component/ContextMenu';
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
}) {
  return (
    <ViewSidebar.Nav ref={props.ref} aria-label={props.label} class="relative">
      {props.children}
    </ViewSidebar.Nav>
  );
}

function Draft(props: { onSelect: () => void }) {
  return (
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
      <span class="ml-auto text-xs text-ink-muted">{t('viewMenus.draft')}</span>
    </ViewSidebar.Item>
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
  /** Status beside the name, such as an unread marker. */
  trailing?: JSX.Element;
  /** Spoken with the name, since the trailing status is decorative. */
  statusLabel?: string;
  reorder?: SavedViewRowReorder;
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
        {/* The actions sit before the status, which keeps the icon rail. */}
        <div
          class="pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-0.5"
          classList={{
            'right-(--sidebar-item-inset)': hasTrailing(),
            'right-(--sidebar-action-inset)': !hasTrailing(),
          }}
        >
          {/* Hover reveals the actions; keyboard focus and an open menu keep them. */}
          <div class="pointer-events-auto opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 has-[[data-expanded]]:opacity-100 touch:opacity-100">
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
          <Show when={hasTrailing()}>
            <ViewSidebar.Trailing>
              {props.trailing}
              <Show when={props.view.sharedTeamId}>
                <UsersIcon class="size-3.5" />
              </Show>
            </ViewSidebar.Trailing>
          </Show>
        </div>
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
