import { ViewSidebar } from '@app/components/view-shell';
import { FavoriteContextMenu } from '@app/features/favorites/FavoriteContextMenu';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { useFavoriteDisplayName } from '@app/util/favorites';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { ChannelLabelMenuItems } from './ChannelLabelRows';
import {
  ChannelRailItemContextMenu,
  isPrimaryMouseDown,
} from './ChannelRailItems';
import { rowKeyForFavorite, useChannelsRail } from './ChannelsRailContext';
import { CollapsibleSection } from './ChannelsRailSection';
import {
  useChannelRailFavoriteItemState,
  useChannelRailFavoritesState,
} from './hooks/useChannelRailState';

/**
 * A favorite row in the Chat sidebar. The rail only favorites channels, so the
 * row carries the same actions as the channel's row in the sections below;
 * until its channel loads (or for a favorite of another kind) it falls back to
 * the shared favorite actions.
 */
export function ChannelFavoriteRow(props: { favorite: Favorite }) {
  const rail = useChannelsRail();
  const displayName = useFavoriteDisplayName(props.favorite);
  const item = useChannelRailFavoriteItemState(() => props.favorite);
  const channel = () =>
    props.favorite.entityType === 'channel'
      ? rail.channelById(props.favorite.entityId)
      : undefined;
  const focusRow = () => {
    rail.list.focus.set(rowKeyForFavorite(props.favorite), {
      reason: 'pointer',
      force: true,
    });
  };

  const row = (
    <ViewSidebar.Item
      as="div"
      id={item().domId}
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'group/channel-option relative',
        !item().selected &&
          !isTouchDevice() &&
          item().focused &&
          'bg-hover text-ink'
      )}
      active={item().selected && !isTouchDevice()}
      aria-current={item().selected ? 'page' : undefined}
      onClick={(event) => {
        if (!isPrimaryMouseDown(event)) return;
        rail.activateRow(rowKeyForFavorite(props.favorite), event);
      }}
    >
      <ViewSidebar.Icon>
        <FavoriteIcon favorite={props.favorite} class="size-4" />
      </ViewSidebar.Icon>
      <span class="min-w-0 flex-1 truncate">{displayName()}</span>
    </ViewSidebar.Item>
  );

  return (
    <Show
      when={channel()}
      fallback={
        <FavoriteContextMenu
          favorite={props.favorite}
          triggerClass="block"
          onOpenChange={(open) => {
            if (open) focusRow();
          }}
        >
          {row}
        </FavoriteContextMenu>
      }
    >
      {(channel) => (
        <ChannelRailItemContextMenu
          channel={channel()}
          rowId={rowKeyForFavorite(props.favorite)}
          class="block w-full"
          extraItems={<ChannelLabelMenuItems channel={channel()} />}
        >
          {row}
        </ChannelRailItemContextMenu>
      )}
    </Show>
  );
}

/** The Chat sidebar's Favorites section, above the channel and DM sections. */
export function ChannelFavoritesSection() {
  const rail = useChannelsRail();
  const section = useChannelRailFavoritesState();

  return (
    <Show when={section().items.length > 0}>
      <CollapsibleSection.Root open={section().open} sizing="content">
        <CollapsibleSection.Header
          focused={section().focused}
          focusWithin={section().containsFocus}
        >
          <button
            id={section().domId}
            type="button"
            role="treeitem"
            tabIndex={-1}
            class="relative flex h-full min-w-0 flex-1 items-center gap-1 rounded-xl px-2 text-left outline-none"
            aria-expanded={section().open}
            onMouseDown={(event) => {
              if (!isPrimaryMouseDown(event)) return;
              event.preventDefault();
              rail.toggleGroup('favorites');
            }}
          >
            <span class="min-w-0 truncate">Favorites</span>
            <CaretDownIcon
              class={cn(
                'size-2.5 shrink-0 opacity-0 transition-[opacity,rotate] duration-200 motion-reduce:transition-none group-hover/sidebar-section:opacity-100',
                !section().open && '-rotate-90 opacity-100'
              )}
            />
          </button>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content
          open={section().open}
          contentRef={(element) => rail.registerScrollRef('favorites', element)}
          class="flex min-h-0 flex-col gap-0.5"
        >
          <For each={section().items}>
            {(favorite) => <ChannelFavoriteRow favorite={favorite} />}
          </For>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}
