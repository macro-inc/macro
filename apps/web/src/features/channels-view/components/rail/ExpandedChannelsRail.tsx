import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { runCreateAction } from '@app/features/command/Launcher';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { useFavoriteDisplayName } from '@app/util/favorites';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { SplitPanel } from '@components/app/split-panel';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import type { ChannelEntity } from '@entity';
import CaretDownIcon from '@phosphor/caret-down.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Button, cn, EmptyStatePanel, Hotkey, Tabs } from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Virtualizer } from 'virtua/solid';
import type { ChannelsGroup } from '../../types';
import { channelMentionsUser, isDirectMessage } from '../../utils';
import { ChannelsEmptyState } from '../ChannelsEmptyState';
import {
  ChannelAvatar,
  ChannelCallIndicator,
  ChannelMutedIndicator,
  ChannelRailItemContextMenu,
  CONVERSATION_CARD_HEIGHT,
  ConversationCard,
  IncomingCallActions,
  isPrimaryMouseDown,
} from './ChannelRailItems';
import {
  domIdForRow,
  rowKeyForChannel,
  rowKeyForFavorite,
  rowKeyForSection,
  useChannelsRail,
} from './ChannelsRailContext';
import {
  CollapsibleSection,
  CreateRailAction,
  RailListError,
  RailListLoading,
  RailListLoadingMore,
  RailModeButton,
} from './ChannelsRailSection';
import {
  useChannelRailFavoriteItemState,
  useChannelRailFavoritesState,
  useChannelRailItemState,
  useChannelRailScopeState,
  useChannelRailSectionState,
  useChannelRailVirtualizer,
} from './hooks/useChannelRailState';

const CHANNEL_TABS = [
  { value: 'browse', label: 'All' },
  { value: 'recents', label: 'Recent' },
];

type ChannelRailSearch = {
  isOpen: Accessor<boolean>;
  query: Accessor<string>;
  results: Accessor<readonly ChannelEntity[]>;
  isLoading: Accessor<boolean>;
  error: Accessor<unknown | undefined>;
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  registerInput: (element: HTMLInputElement) => void;
  retry: () => Promise<void>;
};

type GroupConfig = {
  group: ChannelsGroup;
  label: string;
  emptyLabel: string;
  createLabel: string;
  onCreate: () => void;
};

const GROUPS: GroupConfig[] = [
  {
    group: 'channels',
    label: 'Channels',
    emptyLabel: 'No channels',
    createLabel: 'Create channel',
    onCreate: openNewChannelModal,
  },
  {
    group: 'direct_messages',
    label: 'DMs',
    emptyLabel: 'No direct messages',
    createLabel: 'Start direct message',
    onCreate: () => runCreateAction('channel'),
  },
];

function FavoriteOption(props: { favorite: Favorite }) {
  const rail = useChannelsRail();
  const displayName = useFavoriteDisplayName(props.favorite);
  const item = useChannelRailFavoriteItemState(() => props.favorite);

  return (
    <button
      id={item().domId}
      type="button"
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'flex h-8 w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors',
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
      <span class="flex size-6 shrink-0 items-center justify-center">
        <FavoriteIcon favorite={props.favorite} class="size-4" />
      </span>
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {displayName()}
      </span>
    </button>
  );
}

function ChannelOption(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  const item = useChannelRailItemState(() => props.channel.id);

  return (
    <ChannelRailItemContextMenu channel={props.channel} class="block w-full">
      <div
        id={item().domId}
        role="treeitem"
        tabIndex={-1}
        class={cn(
          'relative flex w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none',
          isDirectMessage(props.channel) ? 'min-h-10 py-2' : 'h-8',
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
        <ChannelAvatar channel={props.channel} />
        <span class="min-w-0 flex-1 truncate text-sm font-medium">
          {props.channel.name}
        </span>
        <ChannelMutedIndicator muted={item().muted} />
        <ChannelCallIndicator
          status={item().incomingCallId ? undefined : item().callStatus}
        />
        <IncomingCallActions
          callId={item().incomingCallId}
          channelId={props.channel.id}
        />
        <Show when={item().unread}>
          <span
            aria-label="Unread"
            class="size-2 shrink-0 rounded-full bg-accent"
          />
        </Show>
      </div>
    </ChannelRailItemContextMenu>
  );
}

function ExpandedFavoritesSection() {
  const rail = useChannelsRail();
  const section = useChannelRailFavoritesState();

  return (
    <Show when={section().items.length > 0}>
      <CollapsibleSection.Root open={section().open}>
        <CollapsibleSection.Header
          focused={section().focused}
          focusWithin={section().containsFocus}
          class="h-9"
        >
          <button
            id={section().domId}
            type="button"
            role="treeitem"
            tabIndex={-1}
            class="relative flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none"
            aria-expanded={section().open}
            onClick={() => rail.activateRow(rowKeyForSection('favorites'))}
          >
            <CaretDownIcon
              class={cn(
                'size-3 shrink-0 transition-transform',
                !section().open && '-rotate-90'
              )}
            />
            <span class="min-w-0 truncate">Favorites</span>
          </button>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content
          open={section().open}
          contentRef={(element) => rail.registerScrollRef('favorites', element)}
          class="flex min-h-0 flex-col gap-0.5"
        >
          <For each={section().items}>
            {(favorite) => <FavoriteOption favorite={favorite} />}
          </For>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}

function ExpandedHeader(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();
  const selectTab = (value: string) => {
    if (value === 'browse' || value === 'recents') {
      rail.selectTab(value);
    }
  };

  return (
    <div class="flex shrink-0 flex-col gap-3">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <SplitPanel.CloseButton />
          <ViewSidebar.Title>Chat</ViewSidebar.Title>
        </div>
        <SplitPanel.ControlGroup>
          <SplitPanel.BackButton />
          <SplitPanel.ForwardButton />
          <RailModeButton expanded onToggle={() => rail.setMode('slim')} />
        </SplitPanel.ControlGroup>
      </ViewSidebar.Header>
      <div class="flex items-center justify-between gap-2 px-4">
        <Tabs
          aria-label="Chat sidebar views"
          list={CHANNEL_TABS}
          value={rail.tab()}
          onChange={selectTab}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          label={
            props.search.isOpen() ? 'Close search' : 'Search conversations'
          }
          aria-pressed={props.search.isOpen()}
          class={cn(
            'size-7 rounded-lg',
            props.search.isOpen() && 'bg-active text-ink'
          )}
          onClick={() =>
            props.search.isOpen() ? props.search.close() : props.search.open()
          }
        >
          <MagnifyingGlassIcon class="size-3.5" />
        </Button>
      </div>
      <Show when={props.search.isOpen()}>
        <div class="px-4">
          <SearchBar
            ref={props.search.registerInput}
            label="Search channels and direct messages"
            placeholder="Search conversations"
            value={props.search.query()}
            hotkey="cmd+f"
            onValueChange={props.search.setQuery}
            onEscape={() => {
              if (!props.search.query()) props.search.close();
            }}
            class="h-9 shrink-0 rounded-xl"
          />
        </div>
      </Show>
    </div>
  );
}

function ExpandedSearchResults(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const pagination = useChannelRailVirtualizer(() => 'search');
  const query = () => props.search.query().trim();
  const focusedIndex = () => {
    const row = rail.list.focus.item();
    return row?.kind === 'conversation' && row.scope === 'search'
      ? row.localIndex
      : -1;
  };

  return (
    <Switch>
      <Match
        when={props.search.isLoading() && props.search.results().length === 0}
      >
        <RailListLoading />
      </Match>
      <Match when={props.search.error() && props.search.results().length === 0}>
        <RailListError retry={props.search.retry} />
      </Match>
      <Match when={props.search.results().length > 0}>
        <div
          ref={setScrollRoot}
          class="scrollbar-hidden size-full min-h-0 overflow-y-auto"
          aria-busy={rail.sources.search.isLoadingMore()}
        >
          <Virtualizer
            ref={pagination.registerVirtualizer}
            data={props.search.results()}
            scrollRef={scrollRoot()}
            itemSize={rail.tab() === 'recents' ? CONVERSATION_CARD_HEIGHT : 42}
            bufferSize={360}
            keepMounted={focusedIndex() >= 0 ? [focusedIndex()] : undefined}
            onScroll={pagination.loadMoreNearEnd}
          >
            {(channel) => (
              <Show
                when={rail.tab() === 'recents'}
                fallback={
                  <div class="px-4 pb-0.5">
                    <ChannelOption channel={channel} />
                  </div>
                }
              >
                <RecentConversationCard channel={channel} />
              </Show>
            )}
          </Virtualizer>
          <Show when={rail.sources.search.isLoadingMore()}>
            <RailListLoadingMore
              variant={rail.tab() === 'recents' ? 'recent' : 'channel'}
            />
          </Show>
          <Show when={props.search.isLoading()}>
            <RailListLoadingMore
              variant={rail.tab() === 'recents' ? 'recent' : 'channel'}
            />
          </Show>
        </div>
      </Match>
      <Match when={true}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoSearchMatchGraphic}
          title={query() ? 'No results' : 'No conversations to show'}
          description={
            query() ? (
              <span>
                No conversations match{' '}
                <span class="[overflow-wrap:anywhere]">“{query()}”</span>
              </span>
            ) : (
              'Channels and direct messages you join will appear here.'
            )
          }
          primaryAction={
            query()
              ? {
                  label: 'Clear search',
                  icon: XIcon,
                  onClick: () => props.search.setQuery(''),
                }
              : undefined
          }
        />
      </Match>
    </Switch>
  );
}

function ExpandedGroupSection(props: { config: GroupConfig }) {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const { state: section } = useChannelRailSectionState(
    () => props.config.group
  );
  const pagination = useChannelRailVirtualizer(() => props.config.group);
  const registerScrollRef = (element: HTMLDivElement) => {
    setScrollRoot(element);
    rail.registerScrollRef(props.config.group, element);
  };

  return (
    <CollapsibleSection.Root
      open={section().open}
      fillAvailable={section().fillAvailable}
    >
      <CollapsibleSection.Header
        focused={section().focused}
        focusWithin={section().containsFocus}
        class="h-9 has-[[data-section-action]:hover]:bg-transparent has-[[data-section-action]:focus-within]:bg-transparent"
      >
        <button
          id={section().domId}
          type="button"
          role="treeitem"
          tabIndex={-1}
          class="relative flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none"
          aria-expanded={section().open}
          onMouseDown={(event) => {
            if (!isPrimaryMouseDown(event)) return;
            rail.activateRow(rowKeyForSection(props.config.group));
          }}
        >
          <CaretDownIcon
            class={cn(
              'size-3 shrink-0 transition-transform',
              !section().open && '-rotate-90'
            )}
          />
          <span class="min-w-0 truncate">{props.config.label}</span>
          <Show when={section().unreadCount > 0}>
            <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none tabular-nums text-accent-contrast">
              {section().unreadCount}
            </span>
          </Show>
        </button>
        <div data-section-action="" class="pr-1">
          <CreateRailAction
            label={props.config.createLabel}
            onClick={props.config.onCreate}
          />
        </div>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content
        open={section().open}
        contentRef={registerScrollRef}
        class="flex min-h-0 flex-col gap-0.5"
        activityTargetId={section().targetId}
        activityLabel={section().label}
      >
        <Switch>
          <Match
            when={section().source.isLoading() && section().items.length === 0}
          >
            <RailListLoading />
          </Match>
          <Match
            when={section().source.error() && section().items.length === 0}
          >
            <RailListError retry={section().source.refresh} />
          </Match>
          <Match when={section().items.length > 0}>
            <Virtualizer
              ref={pagination.registerVirtualizer}
              data={section().items}
              scrollRef={scrollRoot()}
              itemSize={props.config.group === 'channels' ? 34 : 42}
              bufferSize={240}
              keepMounted={section().keepMounted}
              onScroll={pagination.loadMoreNearEnd}
            >
              {(channel) => (
                <div class="pb-0.5">
                  <ChannelOption channel={channel} />
                </div>
              )}
            </Virtualizer>
            <Show when={section().source.isLoadingMore()}>
              <RailListLoadingMore variant="channel" />
            </Show>
            <Show
              when={
                section().source.error() && !section().source.isLoadingMore()
              }
            >
              <RailListError retry={section().source.refresh} compact />
            </Show>
          </Match>
          <Match when={true}>
            <div class="px-2 py-2 text-xs text-ink-extra-muted">
              {props.config.emptyLabel}
            </div>
          </Match>
        </Switch>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

function ExpandedBrowse() {
  const rail = useChannelsRail();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
  const hasItems = () =>
    rail.favorites().length > 0 ||
    rail.sources.channels.items().length > 0 ||
    rail.sources.direct_messages.items().length > 0;
  const sourcesSettled = () =>
    !rail.sources.channels.isLoading() &&
    !rail.sources.direct_messages.isLoading() &&
    !rail.sources.channels.error() &&
    !rail.sources.direct_messages.error();

  return (
    <Switch>
      <Match when={forceEmptyState() || (sourcesSettled() && !hasItems())}>
        <ChannelsEmptyState scope="channels" topAligned />
      </Match>
      <Match when={true}>
        <div class="flex h-full min-h-0 flex-col gap-3 px-4">
          <ExpandedFavoritesSection />
          <For each={GROUPS}>
            {(config) => <ExpandedGroupSection config={config} />}
          </For>
        </div>
      </Match>
    </Switch>
  );
}

function RecentConversationCard(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  const currentUserId = useUserId();
  const item = useChannelRailItemState(() => props.channel.id);

  return (
    <ChannelRailItemContextMenu channel={props.channel} class="block w-full">
      <ConversationCard
        id={item().domId}
        class="border-b border-edge-muted"
        channel={props.channel}
        senderId={props.channel.latestRootMessage?.senderId}
        mentionedCurrentUser={channelMentionsUser(
          props.channel,
          currentUserId()
        )}
        unread={item().unread}
        muted={item().muted}
        callStatus={item().callStatus}
        incomingCallId={item().incomingCallId}
        selected={item().selected}
        focused={item().focused}
        onActivate={() => rail.activateRow(rowKeyForChannel(props.channel.id))}
      />
    </ChannelRailItemContextMenu>
  );
}

function ExpandedRecents() {
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const scope = useChannelRailScopeState(() => 'recents');
  const pagination = useChannelRailVirtualizer(() => 'recents');
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  return (
    <Switch>
      <Match
        when={
          !forceEmptyState() &&
          scope().source.isLoading() &&
          scope().items.length === 0
        }
      >
        <RailListLoading />
      </Match>
      <Match
        when={
          !forceEmptyState() &&
          scope().source.error() &&
          scope().items.length === 0
        }
      >
        <RailListError retry={scope().source.refresh} />
      </Match>
      <Match when={forceEmptyState() || scope().items.length === 0}>
        <ChannelsEmptyState scope="recents" topAligned />
      </Match>
      <Match when={true}>
        <div
          ref={setScrollRoot}
          class="scrollbar-hidden size-full min-h-0 overflow-y-auto"
          aria-busy={scope().source.isLoadingMore()}
        >
          <Virtualizer
            ref={pagination.registerVirtualizer}
            data={scope().items}
            scrollRef={scrollRoot()}
            itemSize={CONVERSATION_CARD_HEIGHT}
            bufferSize={360}
            keepMounted={scope().keepMounted}
            onScroll={pagination.loadMoreNearEnd}
          >
            {(channel) => <RecentConversationCard channel={channel} />}
          </Virtualizer>
          <Show when={scope().source.isLoadingMore()}>
            <RailListLoadingMore variant="recent" />
          </Show>
          <Show
            when={scope().source.error() && !scope().source.isLoadingMore()}
          >
            <RailListError retry={scope().source.refresh} compact />
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

export function ExpandedChannelsRail(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();
  const activeDescendant = () => {
    const rowId = rail.list.focus.key();
    return rowId === undefined ? undefined : domIdForRow(rail.railId, rowId);
  };

  return (
    <>
      <ExpandedHeader search={props.search} />
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          ref={rail.registerRootRef}
          role="tree"
          tabIndex={-1}
          aria-activedescendant={activeDescendant()}
          class="min-h-0 flex-1 overflow-hidden outline-none"
        >
          <Switch>
            <Match when={props.search.isOpen()}>
              <ExpandedSearchResults search={props.search} />
            </Match>
            <Match when={rail.tab() === 'browse'}>
              <ExpandedBrowse />
            </Match>
            <Match when={rail.tab() === 'recents'}>
              <ExpandedRecents />
            </Match>
          </Switch>
        </div>
        <Show when={!props.search.isOpen() && rail.tab() === 'browse'}>
          <footer class="flex h-9 shrink-0 items-center justify-start gap-1 border-t border-edge-muted px-4 text-xxs text-ink-extra-muted">
            <span>Use</span>
            <Hotkey shortcut="[" theme="subtle" />
            <Hotkey shortcut="]" theme="subtle" />
            <span>to jump sections</span>
          </footer>
        </Show>
      </div>
    </>
  );
}
