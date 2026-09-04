import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { makeMuteAction } from '@app/features/next-soup/actions';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  favoriteIconType,
  favoriteSplitContent,
  useFavoriteDisplayName,
  useFavoriteDmRecipientId,
} from '@app/util/favorites';
import { navigateToChannelMessage } from '@block-channel/utils/link';
import { ReadonlyThread } from '@channel/StandaloneThread';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  ContextMenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EntityData } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { isChannelNotification } from '@notifications/notification-helpers';
import { getChannelNotificationParams } from '@notifications/notification-navigation';
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
import { cn, NavRow, Surface } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type ParentProps,
  Show,
} from 'solid-js';

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

const HOVER_PREVIEW_COUNT = 3;

function getPreviewThreadRoots(notifications: UnifiedNotification[]): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const notification of notifications) {
    const { messageId, threadId } = getChannelNotificationParams(notification);
    const rootId = threadId ?? messageId;
    if (!rootId || seen.has(rootId)) continue;
    seen.add(rootId);
    roots.push(rootId);
  }
  return roots;
}

function FavoriteChannelHoverPreview(props: {
  channelId: string;
  notifications: UnifiedNotification[];
}) {
  const orchestrator = useGlobalBlockOrchestrator();
  const roots = () => getPreviewThreadRoots(props.notifications);
  const visible = () => roots().slice(0, HOVER_PREVIEW_COUNT).reverse();
  const hiddenCount = () => roots().length - visible().length;

  return (
    <div class="w-90 min-h-12 max-h-96 overflow-y-auto overscroll-contain flex flex-col py-1">
      <Show when={hiddenCount() > 0}>
        <span class="px-3 py-1 text-xs text-ink-extra-muted">
          +{hiddenCount()} earlier
        </span>
      </Show>
      <For each={visible()}>
        {(rootMessageId) => (
          <ReadonlyThread
            channelId={props.channelId}
            messageId={rootMessageId}
            onClickMessage={(clickedMessageId, e) => {
              e.stopPropagation();
              const isReply = clickedMessageId !== rootMessageId;
              navigateToChannelMessage(
                orchestrator,
                props.channelId,
                clickedMessageId,
                isReply ? rootMessageId : undefined
              );
            }}
          />
        )}
      </For>
    </div>
  );
}

function FavoriteChannelHoverCard(
  props: ParentProps<{
    channelId: string;
    notifications: UnifiedNotification[];
    disabled?: boolean;
    onOpenChange?: (open: boolean) => void;
  }>
) {
  const [hovered, setHovered] = createSignal(false);
  const open = () => hovered() && !props.disabled;

  createEffect(() => props.onOpenChange?.(open()));

  return (
    <Show when={!isTouchDevice()} fallback={props.children}>
      <KobalteTooltip
        open={open()}
        onOpenChange={setHovered}
        placement="right"
        overflowPadding={16}
        fitViewport={true}
        closeDelay={250}
        openDelay={1000}
        flip={true}
        gutter={4}
      >
        <KobalteTooltip.Trigger
          class="inline-flex items-center w-full"
          as="div"
        >
          {props.children}
        </KobalteTooltip.Trigger>
        <KobalteTooltip.Portal>
          <KobalteTooltip.Content class="z-tool-tip max-w-[calc(100vw-32px)] menu-open-animation">
            <Surface depth={3}>
              <FavoriteChannelHoverPreview
                channelId={props.channelId}
                notifications={props.notifications}
              />
            </Surface>
          </KobalteTooltip.Content>
        </KobalteTooltip.Portal>
      </KobalteTooltip>
    </Show>
  );
}

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
  // TODO(dev-rb/notifications): Fetch favorite entities through Soup with
  // their notification edges instead of hydrating them from the REST list.
  // Non-suspending accessor: a pending or failed favorites query must not
  // suspend or crash the sidebar; the section just stays hidden until loaded.
  const favoritesData = useFavoritesData();
  const notificationSource = useGlobalNotificationSource();

  const favorites = () => favoritesData()?.favorites ?? [];
  const unreadNotificationsByChannel = createMemo(() => {
    // TODO(dev-rb/notifications): Restore favorite notification badges,
    // previews, and actions from notifications attached to favorite Soup items.
    if (isFeatureEnabled(enableGraphqlSoup)) {
      return new Map<string, UnifiedNotification[]>();
    }

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
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
  });
  const removeMutation = useRemoveFavoriteMutation();
  // Favorites already store the canonical notification type (`email_thread`),
  // which the mute mapping accepts as-is.
  const favoriteAsEntity = () =>
    ({
      type: props.favorite.entityType,
      id: props.favorite.entityId,
    }) as EntityData;
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
  const canOpenFullscreen = () => layout.getSplitCount() > 1;
  const openInCurrentSplit = () => openFavorite(false);
  const openInNewSplit = () => {
    if (canOpenInNewSplit()) openFavorite(true);
  };
  const openFullscreen = () => {
    const split = layout.replaceAllSplits(content(), {
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
    return split;
  };
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

  const isUnreadChannelFavorite = () =>
    props.favorite.entityType === 'channel' && props.notifications().length > 0;
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [hoverPreviewOpen, setHoverPreviewOpen] = createSignal(false);

  createEffect(() => {
    props.onContextMenuOpenChange?.(contextMenuOpen() || hoverPreviewOpen());
  });

  const row = (
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
        <FavoriteIcon
          favorite={props.favorite}
          class={dmRecipientId() ? 'size-[18px]' : 'size-3.5'}
        />
      </div>
      <span class="min-w-0 truncate">{displayName()}</span>
      <Show when={props.notifications().length > 0}>
        <span class="ml-auto shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-ink/6 text-ink-muted rounded-md">
          {props.notifications().length}
        </span>
      </Show>
    </NavRow>
  );

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
      <ContextMenu onOpenChange={setContextMenuOpen}>
        <ContextMenu.Trigger class="w-full h-7">
          <Show when={isUnreadChannelFavorite()} fallback={row}>
            <FavoriteChannelHoverCard
              channelId={props.favorite.entityId}
              notifications={props.notifications()}
              disabled={contextMenuOpen()}
              onOpenChange={setHoverPreviewOpen}
            >
              {row}
            </FavoriteChannelHoverCard>
          </Show>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenuContent class="text-xs text-ink-muted">
            <MenuGroup>
              <MenuItem
                text="Open in new split"
                onClick={openInNewSplit}
                disabled={!canOpenInNewSplit()}
              />
              <Show when={canOpenFullscreen()}>
                <MenuItem text="Open fullscreen" onClick={openFullscreen} />
              </Show>
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
            <Show when={muteAction.canExecute(favoriteAsEntity())}>
              <MenuSeparator />
              <MenuGroup>
                <MenuItem
                  text={
                    muteAction.isMuted(favoriteAsEntity())
                      ? 'Unmute notifications'
                      : 'Mute notifications'
                  }
                  onClick={() => void muteAction.execute([favoriteAsEntity()])}
                />
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
