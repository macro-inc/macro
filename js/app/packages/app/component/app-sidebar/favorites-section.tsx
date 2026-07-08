import type { SidebarState } from '@app/component/app-sidebar/sidebar';
import { FavoriteIcon } from '@app/component/FavoriteIcon';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  favoriteIconType,
  favoriteSplitContent,
  useFavoriteDisplayName,
  useFavoriteDmRecipientId,
} from '@app/util/favorites';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import { ContextMenu } from '@kobalte/core/context-menu';
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
import { createMemo, createSignal, For, Show } from 'solid-js';

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
export const FavoritesSection = (props: { sidebarState: SidebarState }) => {
  // Non-suspending accessor: a pending or failed favorites query must not
  // suspend or crash the sidebar; the section just stays hidden until loaded.
  const favoritesData = useFavoritesData();

  const favorites = () => favoritesData()?.favorites ?? [];

  return (
    <Show when={props.sidebarState === 'expanded' && favorites().length > 0}>
      <div class="w-full shrink-0 max-h-[40%] overflow-y-auto overscroll-contain">
        <FavoritesGroup
          label="Favorites"
          favorites={favorites()}
          persistKey="sidebar-favorites-expanded"
        />
      </div>
    </Show>
  );
};

const FavoritesGroup = (props: {
  label: string;
  favorites: Favorite[];
  persistKey: string;
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
    <section class="w-full py-1.5">
      <header class="shrink-0 my-1 px-1">
        <button
          type="button"
          class="w-full flex items-center gap-1 text-xs font-medium text-ink-extra-muted/50 hover:text-ink-muted transition-colors"
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
        >
          <h1>{props.label}</h1>
          <CaretDownIcon
            class={cn(
              'size-3 transition-transform duration-200',
              !expanded() && 'rotate-180'
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
              {(favorite, index) => (
                <li
                  class={cn(
                    'w-full transition-[opacity,transform] duration-200 ease-out',
                    expanded()
                      ? 'opacity-100 translate-y-0'
                      : 'opacity-0 -translate-y-2'
                  )}
                  style={{
                    'transition-delay': expanded()
                      ? `${index() * 30}ms`
                      : '0ms',
                  }}
                >
                  <FavoriteRow favorite={favorite} disabled={!expanded()} />
                </li>
              )}
            </For>
          </SortableProvider>
        </ul>
      </div>
    </section>
  );
};

const FavoriteRow = (props: { favorite: Favorite; disabled: boolean }) => {
  const layout = useSplitLayout();
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

  const open = (e: MouseEvent) => {
    layout.openWithSplit(content(), {
      referredFrom: 'sidebar',
      activate: true,
      preferNewSplit: e.shiftKey,
    });
    globalSplitManager()?.returnFocus();
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
      <ContextMenu>
        <ContextMenu.Trigger class="w-full h-8">
          <NavRow
            draggable={false}
            disabled={props.disabled}
            data-sidebar-favorite={favoriteEntityKey(
              props.favorite.entityType,
              props.favorite.entityId
            )}
            data-active={isActive() ? '' : undefined}
            active={isActive()}
            class="h-8"
            fullWidth
            onClick={open}
          >
            <FavoriteIcon favorite={props.favorite} />
            <span class="truncate">{displayName()}</span>
          </NavRow>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenuContent class="text-xs text-ink-muted">
            <MenuItem
              text="Remove from favorites"
              onClick={removeFromFavorites}
            />
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </div>
  );
};
