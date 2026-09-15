import { runCreateAction } from '@app/features/command/Launcher';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import {
  useFavoriteDisplayName,
  useFavoriteDmRecipientId,
} from '@app/util/favorites';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { SplitPanel } from '@components/app/split-panel';
import { UserIcon } from '@core/component/UserIcon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ChannelEntity, Entity } from '@entity';
import ChannelIcon from '@icon/wide-channel.svg';
import { Popover } from '@kobalte/core/popover';
import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import ChatTeardropIcon from '@phosphor/chat-teardrop.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import CheckIcon from '@phosphor/check.svg';
import GearIcon from '@phosphor/gear.svg';
import PlusIcon from '@phosphor/plus.svg';
import StarIcon from '@phosphor/star.svg';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Button, cn, Dropdown, Layer, Tabs, ToggleSwitch, Tooltip } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import type { ChannelListSort, ChannelsGroup } from '../../types';
import { channelInitials, isDirectMessage } from '../../utils';
import {
  ChannelCallIndicator,
  ChannelMutedIndicator,
  ChannelRailItemContextMenu,
  isPrimaryMouseDown,
} from './ChannelRailItems';
import {
  domIdForRow,
  rowKeyForChannel,
  rowKeyForFavorite,
  useChannelsRail,
} from './ChannelsRailContext';
import {
  CollapsibleSection,
  RailListLoading,
  RailListLoadingMore,
  RailModeButton,
} from './ChannelsRailSection';
import {
  useChannelRailFavoriteItemState,
  useChannelRailFavoritesState,
  useChannelRailItemState,
  useChannelRailScopeState,
  useChannelRailVirtualizer,
} from './hooks/useChannelRailState';

function AllTabLabel() {
  return (
    <>
      <span class="sr-only">All</span>
      <span aria-hidden="true" class="[&_svg]:size-4">
        <ChatsIcon />
      </span>
    </>
  );
}

function RecentTabLabel() {
  return (
    <>
      <span class="sr-only">Recent</span>
      <span aria-hidden="true" class="[&_svg]:size-4">
        <ChatTextIcon />
      </span>
    </>
  );
}

const SLIM_CHANNEL_TABS = [
  { value: 'browse', label: AllTabLabel },
  { value: 'recents', label: RecentTabLabel },
];

const SLIM_GROUPS: {
  group: ChannelsGroup;
  label: string;
  icon: () => JSX.Element;
}[] = [
  {
    group: 'channels',
    label: 'Channels',
    icon: () => <ChannelIcon class="size-4" />,
  },
  {
    group: 'direct_messages',
    label: 'DMs',
    icon: () => <ChatTeardropIcon class="size-4" />,
  },
];

const SLIM_SORT_OPTIONS: { value: ChannelListSort; label: string }[] = [
  { value: 'viewed_at', label: 'Last viewed' },
  { value: 'updated_at', label: 'Last updated' },
  { value: 'created_at', label: 'Date created' },
];

const SLIM_ROW_HEIGHT = 42;
const LOAD_MORE_THRESHOLD = 300;

function SlimFavoriteAvatar(props: {
  favorite: Favorite;
  displayName: () => string;
}) {
  const dmRecipientId = useFavoriteDmRecipientId(props.favorite);

  return (
    <Switch>
      <Match when={dmRecipientId()}>
        {(recipientId) => (
          <span class="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-2">
            <UserIcon
              id={recipientId()}
              size="fill"
              suppressClick
              showTooltip={false}
            />
          </span>
        )}
      </Match>
      <Match when={props.favorite.channelType === 'direct_message'}>
        <span class="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-2">
          <FavoriteIcon favorite={props.favorite} class="size-4" />
        </span>
      </Match>
      <Match when={true}>
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 text-xs font-semibold tracking-wide text-ink">
          {channelInitials(props.displayName())}
        </span>
      </Match>
    </Switch>
  );
}

function SlimFavoriteItem(props: { favorite: Favorite }) {
  const rail = useChannelsRail();
  const displayName = useFavoriteDisplayName(props.favorite);
  const item = useChannelRailFavoriteItemState(() => props.favorite);

  return (
    <Tooltip label={displayName()} placement="right" class="size-10">
      <button
        id={item().domId}
        type="button"
        role="treeitem"
        tabIndex={-1}
        class={cn(
          'flex size-10 items-center justify-center rounded-full text-left outline-none transition-colors',
          item().selected && !isTouchDevice() && 'bg-active text-ink',
          (!item().selected || isTouchDevice()) && 'text-ink-muted',
          !item().selected &&
            !isTouchDevice() &&
            item().focused &&
            'bg-hover text-ink',
          !item().selected &&
            !isTouchDevice() &&
            !item().focused &&
            'hover:bg-hover hover:text-ink'
        )}
        aria-current={item().selected ? 'page' : undefined}
        onClick={() => rail.activateRow(rowKeyForFavorite(props.favorite))}
      >
        <SlimFavoriteAvatar
          favorite={props.favorite}
          displayName={displayName}
        />
      </button>
    </Tooltip>
  );
}

function SlimListError(props: { retry: () => Promise<void> }) {
  return (
    <div class="flex min-h-10 items-center justify-center">
      <Button
        variant="outline"
        size="icon-sm"
        label="Retry loading conversations"
        tooltipPlacement="right"
        onClick={() => void props.retry()}
      >
        <ArrowClockwiseIcon class="size-4" />
      </Button>
    </div>
  );
}

function SlimFavoritesSection() {
  const rail = useChannelsRail();
  const section = useChannelRailFavoritesState();

  return (
    <Show when={section().items.length > 0}>
      <CollapsibleSection.Root open={section().open} class="items-center">
        <CollapsibleSection.Header
          focused={section().focused}
          focusWithin={section().containsFocus}
          class="h-10 justify-center"
        >
          <button
            id={section().domId}
            type="button"
            role="treeitem"
            tabIndex={-1}
            class="relative flex size-10 min-w-10 flex-none items-center justify-center rounded-full outline-none"
            aria-expanded={section().open}
            aria-label="Favorites"
            onMouseDown={(event) => {
              if (!isPrimaryMouseDown(event)) return;
              event.preventDefault();
              rail.toggleGroup('favorites');
            }}
          >
            <StarIcon class="size-4" />
          </button>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content
          open={section().open}
          contentRef={(element) => rail.registerScrollRef('favorites', element)}
          containerClass="w-full"
          class="flex min-h-0 w-full flex-col items-center gap-0.5"
        >
          <For each={section().items}>
            {(favorite) => (
              <div class="flex justify-center">
                <SlimFavoriteItem favorite={favorite} />
              </div>
            )}
          </For>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}

function SlimChannelAvatar(props: { channel: ChannelEntity }) {
  return (
    <Switch>
      <Match when={isDirectMessage(props.channel)}>
        <span class="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-2 [&_img]:size-full [&_svg]:size-4 [&_svg]:shrink-0">
          <Entity.Icon
            entity={props.channel}
            suppressClick
            showTooltip={false}
          />
        </span>
      </Match>
      <Match when={true}>
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 text-xs font-semibold tracking-wide text-ink">
          {channelInitials(props.channel.name)}
        </span>
      </Match>
    </Switch>
  );
}

function SlimChannelItem(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  const item = useChannelRailItemState(() => props.channel.id);

  return (
    <ChannelRailItemContextMenu
      channel={props.channel}
      class="block size-10 self-center"
    >
      <Tooltip label={props.channel.name} placement="right" class="size-10">
        <button
          id={item().domId}
          type="button"
          role="treeitem"
          tabIndex={-1}
          class={cn(
            'flex size-10 items-center justify-center rounded-full text-left outline-none',
            item().selected && !isTouchDevice() && 'bg-active text-ink',
            (!item().selected || isTouchDevice()) && 'text-ink-muted',
            !item().selected &&
              !isTouchDevice() &&
              item().focused &&
              'bg-hover text-ink',
            !item().selected &&
              !isTouchDevice() &&
              !item().focused &&
              'hover:bg-hover hover:text-ink'
          )}
          aria-current={item().selected ? 'page' : undefined}
          onMouseDown={(event) => {
            if (!isPrimaryMouseDown(event)) return;
            rail.activateRow(rowKeyForChannel(props.channel.id));
          }}
        >
          <span class="relative">
            <SlimChannelAvatar channel={props.channel} />
            <Show
              when={item().callStatus}
              fallback={
                <ChannelMutedIndicator
                  muted={item().muted}
                  class="absolute -bottom-0.5 -right-0.5 rounded-full bg-inset p-0.5"
                />
              }
            >
              {(callStatus) => (
                <ChannelCallIndicator
                  status={callStatus()}
                  class="absolute -bottom-0.5 -right-0.5 rounded-full bg-inset p-0.5"
                />
              )}
            </Show>
            <Show when={item().unread}>
              <span
                aria-label="Unread"
                class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-surface"
              />
            </Show>
          </span>
        </button>
      </Tooltip>
    </ChannelRailItemContextMenu>
  );
}

function SlimCreateMenu() {
  return (
    <Dropdown placement="right-start" gutter={8}>
      <Dropdown.Trigger
        variant="outline"
        size="icon-sm"
        class="size-10 rounded-full bg-transparent"
        label="Create conversation"
      >
        <PlusIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-44">
        <Dropdown.Group>
          <Dropdown.Item onSelect={() => openNewChannelModal()}>
            <ChannelIcon class="size-4 shrink-0" />
            <span>Create channel</span>
          </Dropdown.Item>
          <Dropdown.Item onSelect={() => runCreateAction('channel')}>
            <ChatTeardropIcon class="size-4 shrink-0" />
            <span>Start direct message</span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function SlimHeader() {
  const rail = useChannelsRail();
  const selectTab = (value: string) => {
    if (value === 'browse' || value === 'recents') {
      rail.selectTab(value);
    }
  };

  return (
    <div class="flex shrink-0 flex-col items-center gap-3 pt-2">
      <div class="flex h-8 w-full items-center justify-between px-1">
        <SplitPanel.CloseButton size="icon-sm" />
        <RailModeButton
          expanded={false}
          onToggle={() => rail.setMode('full')}
        />
      </div>
      <div class="w-full px-3">
        <Tabs
          aria-label="Chat sidebar views"
          class="h-20 flex-col"
          itemClass="h-auto min-h-0 w-full"
          labelClass="size-full p-0"
          fullWidth
          list={SLIM_CHANNEL_TABS}
          value={rail.tab()}
          onChange={selectTab}
        />
      </div>
      <div class="w-full border-t border-edge-muted" />
      <div class="flex w-full justify-center px-2">
        <SlimCreateMenu />
      </div>
      <div class="w-full border-t border-edge-muted" />
    </div>
  );
}

function SlimBrowseConversations() {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
  const channels = useChannelRailScopeState(() => 'channels');
  const directMessages = useChannelRailScopeState(() => 'direct_messages');
  const channelItems = () =>
    rail.slimGroupEnabled('channels') ? channels().items : [];
  const directMessageItems = () =>
    rail.slimGroupEnabled('direct_messages') ? directMessages().items : [];
  const items = createMemo(() => [...channelItems(), ...directMessageItems()]);
  const keepMounted = createMemo(() => {
    const indexes = rail.slimGroupEnabled('channels')
      ? [...(channels().keepMounted ?? [])]
      : [];
    if (rail.slimGroupEnabled('direct_messages')) {
      const offset = channelItems().length;
      indexes.push(
        ...(directMessages().keepMounted ?? []).map((index) => offset + index)
      );
    }
    return indexes.length > 0 ? [...new Set(indexes)] : undefined;
  });

  let unregisterVirtualizers: (() => void)[] = [];
  const registerVirtualizer = (handle?: VirtualizerHandle) => {
    for (const unregister of unregisterVirtualizers) unregister();
    unregisterVirtualizers = [];
    setVirtualizer(handle);
    if (!handle) return;

    unregisterVirtualizers = SLIM_GROUPS.map(({ group }) =>
      rail.registerVirtualizer(group, handle)
    );
  };
  onCleanup(() => {
    for (const unregister of unregisterVirtualizers) unregister();
  });

  const registerScrollRoot = (element: HTMLDivElement) => {
    setScrollRoot(element);
    for (const { group } of SLIM_GROUPS) {
      rail.registerScrollRef(group, element);
    }
  };
  const visibleGroups = () =>
    SLIM_GROUPS.filter(({ group }) => rail.slimGroupEnabled(group));
  const isInitialLoading = () =>
    items().length === 0 &&
    visibleGroups().some(({ group }) => rail.sources[group].isLoading());
  const hasError = () =>
    visibleGroups().some(({ group }) => rail.sources[group].error());
  const isLoadingMore = () =>
    visibleGroups().some(({ group }) => rail.sources[group].isLoadingMore());
  const retry = async () => {
    await Promise.all(
      visibleGroups().map(({ group }) => rail.sources[group].refresh())
    );
  };
  const loadMoreNearEnd = (offset?: number) => {
    const handle = virtualizer();
    if (!handle) return;

    const viewportEnd = (offset ?? handle.scrollOffset) + handle.viewportSize;
    let groupEnd = 0;
    for (const { group } of visibleGroups()) {
      const source = rail.sources[group];
      groupEnd += source.items().length * SLIM_ROW_HEIGHT;
      if (
        groupEnd - viewportEnd > LOAD_MORE_THRESHOLD ||
        source.isLoadingMore() ||
        !source.hasMore()
      ) {
        continue;
      }
      void source.loadMore();
    }
  };

  return (
    <Switch>
      <Match when={forceEmptyState()}>{null}</Match>
      <Match when={isInitialLoading()}>
        <RailListLoading />
      </Match>
      <Match when={hasError() && items().length === 0}>
        <SlimListError retry={retry} />
      </Match>
      <Match when={items().length > 0}>
        <div
          ref={registerScrollRoot}
          class="scrollbar-hidden size-full min-h-0 overflow-y-auto"
          aria-busy={isLoadingMore()}
        >
          <Virtualizer
            ref={registerVirtualizer}
            data={items()}
            scrollRef={scrollRoot()}
            itemSize={SLIM_ROW_HEIGHT}
            bufferSize={240}
            keepMounted={keepMounted()}
            onScroll={loadMoreNearEnd}
          >
            {(channel) => (
              <div class="flex justify-center pb-0.5">
                <SlimChannelItem channel={channel} />
              </div>
            )}
          </Virtualizer>
          <Show when={isLoadingMore()}>
            <RailListLoadingMore variant="slim" />
          </Show>
          <Show when={hasError() && !isLoadingMore()}>
            <SlimListError retry={retry} />
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

function SlimBrowse() {
  return (
    <div class="flex h-full min-h-0 flex-col gap-2 px-2">
      <SlimFavoritesSection />
      <div class="min-h-0 flex-1">
        <SlimBrowseConversations />
      </div>
    </div>
  );
}

function SlimRecents() {
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const scope = useChannelRailScopeState(() => 'recents');
  const pagination = useChannelRailVirtualizer(() => 'recents');
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  return (
    <Switch>
      <Match when={forceEmptyState()}>{null}</Match>
      <Match when={scope().source.isLoading() && scope().items.length === 0}>
        <RailListLoading />
      </Match>
      <Match when={scope().source.error() && scope().items.length === 0}>
        <SlimListError retry={scope().source.refresh} />
      </Match>
      <Match when={scope().items.length > 0}>
        <div
          ref={setScrollRoot}
          class="scrollbar-hidden size-full min-h-0 overflow-y-auto"
          aria-busy={scope().source.isLoadingMore()}
        >
          <Virtualizer
            ref={pagination.registerVirtualizer}
            data={scope().items}
            scrollRef={scrollRoot()}
            itemSize={42}
            bufferSize={240}
            keepMounted={scope().keepMounted}
            onScroll={pagination.loadMoreNearEnd}
          >
            {(channel) => (
              <div class="flex justify-center pb-0.5">
                <SlimChannelItem channel={channel} />
              </div>
            )}
          </Virtualizer>
          <Show when={scope().source.isLoadingMore()}>
            <RailListLoadingMore variant="slim" />
          </Show>
          <Show
            when={scope().source.error() && !scope().source.isLoadingMore()}
          >
            <SlimListError retry={scope().source.refresh} />
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

function SlimRailSettings() {
  const rail = useChannelsRail();

  return (
    <footer class="flex h-12 shrink-0 items-center justify-center border-t border-edge-muted px-2">
      <Popover placement="right-end" gutter={8}>
        <Popover.Trigger
          as={Button}
          variant="ghost"
          size="icon-sm"
          class="rounded-lg"
          label="Chat rail settings"
        >
          <GearIcon class="size-4" />
        </Popover.Trigger>
        <Popover.Portal>
          <Layer depth={3}>
            <Popover.Content
              class="portal-scope z-action-menu w-56 rounded-xl border border-edge bg-menu-glass p-2 glass menu-open-animation"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <Popover.Title class="px-2 py-1 text-xs font-medium text-ink">
                Chat rail
              </Popover.Title>
              <div class="flex flex-col gap-1">
                <For each={SLIM_GROUPS}>
                  {(config) => (
                    <section class="rounded-lg border border-edge-muted p-2">
                      <div class="flex items-center gap-2">
                        <span class="flex size-4 shrink-0 items-center justify-center text-ink-muted">
                          {config.icon()}
                        </span>
                        <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                          {config.label}
                        </span>
                        <ToggleSwitch
                          size="xs"
                          checked={rail.slimGroupEnabled(config.group)}
                          onChange={(enabled) =>
                            rail.setSlimGroupEnabled(config.group, enabled)
                          }
                          label={`Show ${config.label.toLowerCase()}`}
                          labelClass="sr-only"
                        />
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={`Sort ${config.label.toLowerCase()}`}
                        class="mt-2 flex flex-col gap-0.5"
                      >
                        <For each={SLIM_SORT_OPTIONS}>
                          {(option) => {
                            const selected = () =>
                              rail.sortBy(config.group) === option.value;
                            return (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={selected()}
                                class={cn(
                                  'flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink',
                                  selected() && 'bg-active text-ink'
                                )}
                                onClick={() =>
                                  rail.setSortBy(config.group, option.value)
                                }
                              >
                                <span class="min-w-0 flex-1 truncate">
                                  {option.label}
                                </span>
                                <Show when={selected()}>
                                  <CheckIcon class="size-3 shrink-0 text-accent" />
                                </Show>
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </div>
            </Popover.Content>
          </Layer>
        </Popover.Portal>
      </Popover>
    </footer>
  );
}

export function SlimChannelsRail() {
  const rail = useChannelsRail();
  const activeDescendant = () => {
    const rowId = rail.list.focus.key();
    return rowId === undefined ? undefined : domIdForRow(rail.railId, rowId);
  };

  return (
    <>
      <SlimHeader />
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          ref={rail.registerRootRef}
          role="tree"
          tabIndex={-1}
          aria-activedescendant={activeDescendant()}
          class="min-h-0 flex-1 overflow-hidden outline-none"
        >
          <Switch>
            <Match when={rail.tab() === 'browse'}>
              <SlimBrowse />
            </Match>
            <Match when={rail.tab() === 'recents'}>
              <SlimRecents />
            </Match>
          </Switch>
        </div>
      </div>
      <SlimRailSettings />
    </>
  );
}
