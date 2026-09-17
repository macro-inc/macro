import { ViewSidebarToggle } from '@app/components/view-shell/ViewShell';
import { ViewSidebar } from '@app/components/view-shell/ViewSidebar';
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
import { Popover } from '@kobalte/core/popover';
import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ChatTeardropIcon from '@phosphor/chat-teardrop.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import CheckIcon from '@phosphor/check.svg';
import GearIcon from '@phosphor/gear.svg';
import ChannelIcon from '@phosphor/hash-straight.svg';
import PlusIcon from '@phosphor/plus.svg';
import StarIcon from '@phosphor/star.svg';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Button, cn, Dropdown, Layer, Tabs, ToggleSwitch, Tooltip } from '@ui';
import {
  createMemo,
  createSignal,
  For,
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
}[] = [
  { group: 'channels', label: 'Channels' },
  { group: 'direct_messages', label: 'DMs' },
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
          'relative flex size-10 items-center justify-center rounded-full text-left outline-none transition-colors',
          item().selected && 'text-ink',
          !item().selected && 'text-ink-muted',
          !item().selected && !isTouchDevice() && item().focused && 'text-ink',
          !item().selected &&
            !isTouchDevice() &&
            'hover:bg-hover hover:text-ink'
        )}
        aria-current={item().selected ? 'page' : undefined}
        onClick={(event) =>
          rail.activateRow(rowKeyForFavorite(props.favorite), event)
        }
      >
        <span
          aria-hidden="true"
          class={cn(
            'absolute -left-3 top-1/2 z-1 h-3 w-1 -translate-y-1/2 rounded-r-full bg-ink transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
            item().selected ? 'scale-y-100 opacity-100' : 'scale-y-90 opacity-0'
          )}
        />
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
          focused={false}
          focusWithin={section().containsFocus}
          class="h-10 justify-center"
        >
          <Tooltip
            label={`Favorites (${section().open ? 'expanded' : 'collapsed'})`}
            placement="right"
            class="size-10"
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
          </Tooltip>
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
            'relative flex size-10 items-center justify-center rounded-full text-left outline-none',
            item().selected && 'text-ink',
            !item().selected && 'text-ink-muted',
            !item().selected &&
              !isTouchDevice() &&
              item().focused &&
              'text-ink',
            !item().selected &&
              !isTouchDevice() &&
              'hover:bg-hover hover:text-ink'
          )}
          aria-current={item().selected ? 'page' : undefined}
          onMouseDown={(event) => {
            if (!isPrimaryMouseDown(event)) return;
            rail.activateRow(rowKeyForChannel(props.channel.id), event);
          }}
        >
          <span
            aria-hidden="true"
            class={cn(
              'absolute -left-3 top-1/2 z-1 h-3 w-1 -translate-y-1/2 rounded-r-full bg-ink transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
              item().selected
                ? 'scale-y-100 opacity-100'
                : 'scale-y-90 opacity-0'
            )}
          />
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
      <div class="flex w-full items-center justify-center px-2">
        <SplitPanel.ControlGroup>
          <ViewSidebar.CloseButton />
          <ViewSidebarToggle action="collapse" />
        </SplitPanel.ControlGroup>
      </div>
      <div class="flex h-8 w-full items-center justify-center px-2">
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
    <div class="flex h-full min-h-0 flex-col gap-2">
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

function SlimSortDropdown(props: { group: ChannelsGroup; label: string }) {
  const rail = useChannelsRail();
  const selected = () =>
    SLIM_SORT_OPTIONS.find(
      (option) => option.value === rail.sortBy(props.group)
    );
  const setSort = (value: string) => {
    const option = SLIM_SORT_OPTIONS.find((item) => item.value === value);
    if (option) rail.setSortBy(props.group, option.value);
  };

  return (
    <Dropdown placement="right-start">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        class="h-7 min-w-28 justify-between gap-1 rounded-lg px-2 text-sm font-normal"
        aria-label={`Sort ${props.label.toLowerCase()}`}
      >
        <span class="truncate">{selected()?.label}</span>
        <CaretDownIcon class="size-2.5 shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-36">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={rail.sortBy(props.group)}
            onChange={setSort}
          >
            <For each={SLIM_SORT_OPTIONS}>
              {(option) => (
                <Dropdown.RadioItem closeOnSelect value={option.value}>
                  <span class="flex-1">{option.label}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
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
          size="icon-md"
          class="rounded-lg data-expanded:bg-active data-expanded:text-ink"
          label="Chat rail settings"
        >
          <GearIcon class="size-4" />
        </Popover.Trigger>
        <Popover.Portal>
          <Layer depth={3}>
            <Popover.Content
              class="portal-scope z-action-menu w-56 overflow-hidden rounded-xl border border-edge bg-menu-glass text-sm [--color-surface:var(--color-menu)] glass menu-open-animation"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <Popover.Title class="sr-only">Chat rail settings</Popover.Title>
              <div class="flex size-full flex-col gap-(--app-border-width) bg-edge-muted/60">
                <For each={SLIM_GROUPS}>
                  {(config) => (
                    <section class="flex flex-col bg-menu p-1.5">
                      <h3 class="flex h-7 items-center px-2 text-xs font-normal text-ink-extra-muted">
                        {config.label}
                      </h3>
                      <div class="flex h-8 items-center justify-between gap-3 rounded-lg px-2 font-normal text-ink">
                        <span>Visible</span>
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
                      <div class="flex h-8 items-center justify-between gap-3 rounded-lg px-2 font-normal text-ink">
                        <span>Sort by</span>
                        <SlimSortDropdown
                          group={config.group}
                          label={config.label}
                        />
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
