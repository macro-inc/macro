import type { SidebarState } from '@app/component/app-sidebar/sidebar';
import { FavoriteIcon } from '@app/component/FavoriteIcon';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  favoriteIconType,
  favoriteSplitContent,
  useFavoriteDisplayName,
  useFavoriteDmRecipientId,
} from '@app/util/favorites';
import {
  ContextMenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import { ContextMenu } from '@kobalte/core/context-menu';
import { isChannelNotification } from '@notifications/notification-helpers';
import type { UnifiedNotification } from '@notifications/types';
import CaretDownIcon from '@phosphor/caret-down.svg';
import {
  favoriteEntityKey,
  useFavoritesData,
  useRemoveFavoriteMutation,
  useReorderFavoritesMutation,
} from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { makePersisted } from '@solid-primitives/storage';
import {
  createSortable,
  SortableProvider,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { cn, NavRow } from '@ui';
import { type Accessor, createMemo, createSignal, For, Show } from 'solid-js';

/**
 * Drag data carried by favorite row sortables. Distinct from `EntityDragData`
 * (`dragType: 'entity'`) so entity drop consumers ignore favorite drags; the
 * global `ItemDragOverlay` branches on it to render its chip.
 */
export type FavoriteDragData = {
  dragType: 'favorite';
  iconType: EntityIconSelector;
  name: string;
  /** Other participant of a DM channel favorite; the drag overlay shows
   * their avatar instead of the entity icon. */
  dmRecipientId?: string;
  /** Read by the `pointerWithin` collision detector to skip collapsed rows. */
  isDropTargetDisabled: () => boolean;
};

/**
 * Linear-style favorites for the expanded sidebar: a collapsible "Favorites"
 * list of the user's favorited entities. Rows navigate like other sidebar rows
 * and are drag-reorderable. Hidden entirely in slim mode and when the user has
 * no favorites.
 */
export const FavoritesSection = (props: {
  sidebarState: SidebarState;
  onContextMenuOpenChange?: (open: boolean) => void;
}) => {
  // Non-suspending accessor: a pending or failed favorites query must not
  // suspend or crash the sidebar; the section just stays hidden until loaded.
  const favoritesData = useFavoritesData();
  const notificationSource = useGlobalNotificationSource();

  const favorites = () => favoritesData()?.favorites ?? [];
  const unreadNotificationsByChannel = createMemo(() => {
    const notificationsByChannel = new Map<string, UnifiedNotification[]>();
    for (const notification of notificationSource.notifications()) {
      if (
        !isChannelNotification(notification) ||
        notification.viewed_at ||
        notification.done
      ) {
        continue;
      }
      const notifications = notificationsByChannel.get(notification.entity_id);
      if (notifications) {
        notifications.push(notification);
      } else {
        notificationsByChannel.set(notification.entity_id, [notification]);
      }
    }
    return notificationsByChannel;
  });

  return (
    <Show when={props.sidebarState === 'expanded' && favorites().length > 0}>
      <div class="w-full shrink-0">
        <FavoritesGroup
          label="Favorites"
          favorites={favorites()}
          persistKey="sidebar-favorites-expanded"
          onContextMenuOpenChange={props.onContextMenuOpenChange}
          unreadNotificationsByChannel={unreadNotificationsByChannel}
        />
      </div>
    </Show>
  );
};

const FavoritesGroup = (props: {
  label: string;
  favorites: Favorite[];
  persistKey: string;
  onContextMenuOpenChange?: (open: boolean) => void;
  unreadNotificationsByChannel: Accessor<
    ReadonlyMap<string, UnifiedNotification[]>
  >;
}) => {
  const [expanded, setExpanded] = makePersisted(createSignal(true), {
    name: props.persistKey,
  });
  const reorderMutation = useReorderFavoritesMutation();

  // Rows are keyed by what they point at; favorites have no surrogate id.
  const keys = createMemo(() =>
    props.favorites.map((favorite) =>
      favoriteEntityKey(favorite.entityType, favorite.entityId)
    )
  );
  const notificationsForFavorite = (favorite: Favorite) => () =>
    favorite.entityType === 'channel'
      ? (props.unreadNotificationsByChannel().get(favorite.entityId) ?? [])
      : [];

  // The sidebar lives inside the app-wide DragDropProvider (ItemDndProvider);
  // register on its events rather than mounting a nested provider.
  const [, dndActions] = useDragDropContext() ?? [];

  dndActions?.onDragEnd(({ draggable, droppable }) => {
    const dragData = draggable.data;
    if (dragData?.dragType !== 'favorite') return;
    // Dropping outside the list leaves the order unchanged.
    if (!droppable) return;
    const dropData = droppable.data;
    if (dropData?.dragType !== 'favorite') return;
    const current = keys();
    const fromIndex = current.indexOf(String(draggable.id));
    const toIndex = current.indexOf(String(droppable.id));
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const ordered = props.favorites.slice();
    ordered.splice(toIndex, 0, ...ordered.splice(fromIndex, 1));
    reorderMutation.mutate({
      favorites: ordered.map((favorite) => ({
        entityType: favorite.entityType,
        entityId: favorite.entityId,
      })),
    });
  });

  return (
    <section class="w-full flex flex-col">
      <header>
        <button
          type="button"
          class="group/section flex h-7 w-full items-center justify-start gap-1 rounded-md px-2 text-left text-[13px] font-medium text-ink-extra-muted/60 transition-colors hover:bg-ink/3 hover:text-ink-muted"
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
        >
          <span class="min-w-0 truncate">{props.label}</span>
          <CaretDownIcon
            class={cn(
              'size-3 shrink-0 transition-transform duration-[120ms] ease-in-out',
              !expanded() && '-rotate-90'
            )}
          />
        </button>
      </header>

      <div
        class="grid w-full transition-[grid-template-rows] duration-200 ease-out"
        style={{ 'grid-template-rows': expanded() ? '1fr' : '0fr' }}
      >
        <ul class="min-h-0 overflow-hidden flex flex-col gap-0.5">
          <SortableProvider ids={keys()}>
            <For each={props.favorites}>
              {(favorite) => (
                <li
                  class={cn(
                    'w-full transition-[opacity,transform] duration-200 ease-out',
                    expanded()
                      ? 'opacity-100 translate-y-0'
                      : 'opacity-0 -translate-y-2'
                  )}
                >
                  <FavoriteRow
                    favorite={favorite}
                    disabled={!expanded()}
                    onContextMenuOpenChange={props.onContextMenuOpenChange}
                    notifications={notificationsForFavorite(favorite)}
                  />
                </li>
              )}
            </For>
          </SortableProvider>
        </ul>
      </div>
    </section>
  );
};

const FavoriteRow = (props: {
  favorite: Favorite;
  disabled: boolean;
  onContextMenuOpenChange?: (open: boolean) => void;
  notifications: Accessor<UnifiedNotification[]>;
}) => {
  const layout = useSplitLayout();
  const notificationSource = useGlobalNotificationSource();
  const removeMutation = useRemoveFavoriteMutation();
  const [dndState] = useDragDropContext() ?? [];

  const displayName = useFavoriteDisplayName(props.favorite);
  const dmRecipientId = useFavoriteDmRecipientId(props.favorite);

  // `For` keys rows by favorite identity, so the favorite (and drag data
  // derived from it) is stable for the row's lifetime.
  //
  // `isDropTargetDisabled` is read by the app's `pointerWithin` collision
  // detector (see ItemDragAndDrop). A collapsed group still renders its rows
  // (clipped to 0 height for the expand/collapse animation), so without this
  // their stale layout rects would capture drops. Gating on `disabled` keeps
  // collapsed rows out of collision detection entirely.
  //
  // `name` and `dmRecipientId` are getters so the drag overlay chip reads
  // the row's live values (names resolve asynchronously through the preview
  // cache, DM recipients through the channels list).
  const sortable = createSortable(
    favoriteEntityKey(props.favorite.entityType, props.favorite.entityId),
    {
      dragType: 'favorite',
      iconType: favoriteIconType(props.favorite),
      get name() {
        return displayName();
      },
      get dmRecipientId() {
        return dmRecipientId();
      },
      isDropTargetDisabled: () => props.disabled,
    } satisfies FavoriteDragData
  );

  const content = () => favoriteSplitContent(props.favorite);

  const isActive = () => {
    const active = globalSplitManager()?.activeSplit()?.content();
    return (
      !!active &&
      active.type !== 'component' &&
      active.id === props.favorite.entityId
    );
  };

  const openFavorite = (preferNewSplit: boolean) => {
    const split = layout.openWithSplit(content(), {
      referredFrom: 'sidebar',
      activate: true,
      preferNewSplit,
    });
    globalSplitManager()?.returnFocus();
    return split;
  };

  const open = (e: MouseEvent) => openFavorite(e.shiftKey);
  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? false;
  const openInCurrentSplit = () => openFavorite(false);
  const openInNewSplit = () => {
    if (canOpenInNewSplit()) openFavorite(true);
  };
  const openFullscreen = () => layout.popoverSplit(content());
  const markAllAsRead = () => {
    void notificationSource.bulkMarkAsRead(props.notifications());
  };
  const markAllAsDone = () => {
    void notificationSource.bulkMarkAsDone(props.notifications());
  };

  const removeFromFavorites = () => {
    removeMutation.mutate({
      entityType: props.favorite.entityType,
      entityId: props.favorite.entityId,
    });
  };

  return (
    <div
      ref={sortable}
      class={cn(
        'w-full',
        // Smoothly shift rows out of the way while a drag is live; snap
        // (no transition) when it ends so the settled order doesn't animate
        // twice.
        !!dndState?.active.draggable && 'transition-transform',
        sortable.isActiveDraggable && 'opacity-40'
      )}
    >
      <ContextMenu onOpenChange={props.onContextMenuOpenChange}>
        <ContextMenu.Trigger class="w-full h-7">
          <NavRow
            draggable={false}
            disabled={props.disabled}
            data-sidebar-favorite={favoriteEntityKey(
              props.favorite.entityType,
              props.favorite.entityId
            )}
            data-active={isActive() ? '' : undefined}
            active={isActive()}
            class="h-7"
            fullWidth
            onClick={open}
          >
            <div class="size-5 shrink-0 flex items-center justify-center">
              <FavoriteIcon favorite={props.favorite} class="size-3.5" />
            </div>
            <span class="min-w-0 truncate">{displayName()}</span>
            <Show when={props.notifications().length > 0}>
              <span class="ml-auto shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-ink/6 text-ink-muted rounded-md">
                {props.notifications().length}
              </span>
            </Show>
          </NavRow>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenuContent class="text-xs text-ink-muted">
            <MenuGroup>
              <MenuItem
                text="Open in new split"
                onClick={openInNewSplit}
                disabled={!canOpenInNewSplit()}
              />
              <MenuItem text="Open fullscreen" onClick={openFullscreen} />
              <MenuItem
                text="Open in current split"
                onClick={openInCurrentSplit}
              />
            </MenuGroup>
            <Show when={props.notifications().length > 0}>
              <MenuSeparator />
              <MenuGroup>
                <MenuItem text="Mark all as read" onClick={markAllAsRead} />
                <MenuItem text="Mark all as done" onClick={markAllAsDone} />
              </MenuGroup>
            </Show>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem
                text="Remove from favorites"
                onClick={removeFromFavorites}
              />
            </MenuGroup>
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </div>
  );
};
