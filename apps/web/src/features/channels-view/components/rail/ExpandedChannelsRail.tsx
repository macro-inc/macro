import { runCreateAction } from '@app/features/command/Launcher';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { SplitPanel } from '@components/app/split-panel';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ChannelEntity } from '@entity';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { cn, Hotkey, Tabs } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { Virtualizer } from 'virtua/solid';
import type { ChannelsGroup } from '../../types';
import { channelMentionsUser, isDirectMessage } from '../../utils';
import { ChannelsEmptyState } from '../ChannelsEmptyState';
import {
  ChannelAvatar,
  ChannelCallIndicator,
  ChannelMutedIndicator,
  ChannelRailItemContextMenu,
  ConversationCard,
  IncomingCallActions,
} from './ChannelRailItems';
import {
  domIdForRow,
  rowKeyForChannel,
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
  useChannelRailItemState,
  useChannelRailScopeState,
  useChannelRailSectionState,
  useChannelRailVirtualizer,
} from './hooks/useChannelRailState';

const CHANNEL_TABS = [
  { value: 'browse', label: 'Browse' },
  { value: 'recents', label: 'Recents' },
];

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
          'relative flex w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors',
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
        onClick={() => rail.activateRow(rowKeyForChannel(props.channel.id))}
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

function ExpandedHeader() {
  const rail = useChannelsRail();
  const selectTab = (value: string) => {
    if (value === 'browse' || value === 'recents') {
      rail.selectTab(value);
    }
  };

  return (
    <div class="flex shrink-0 flex-col gap-3 px-4">
      <div class="flex items-center">
        <SplitPanel.ControlGroup>
          <SplitPanel.CloseButton />
          <SplitPanel.BackButton />
          <SplitPanel.ForwardButton />
        </SplitPanel.ControlGroup>
      </div>
      <div class="flex h-8 items-center gap-2">
        <RailModeButton expanded onToggle={() => rail.setMode('slim')} />
        <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
          Chat
        </h1>
      </div>
      <Tabs
        aria-label="Chat sidebar views"
        fullWidth
        list={CHANNEL_TABS}
        value={rail.tab()}
        onChange={selectTab}
      />
    </div>
  );
}

function ExpandedGroupSection(props: { config: GroupConfig }) {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const { state: section, clearVisibleActivity } = useChannelRailSectionState(
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
          onClick={() => rail.activateRow(rowKeyForSection(props.config.group))}
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
        onActivityVisible={clearVisibleActivity}
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
            itemSize={72}
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

export function ExpandedChannelsRail() {
  const rail = useChannelsRail();
  const activeDescendant = () => {
    const rowId = rail.list.focus.key();
    return rowId === undefined ? undefined : domIdForRow(rail.railId, rowId);
  };

  return (
    <>
      <ExpandedHeader />
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
              <ExpandedBrowse />
            </Match>
            <Match when={rail.tab() === 'recents'}>
              <ExpandedRecents />
            </Match>
          </Switch>
        </div>
        <Show when={rail.tab() === 'browse'}>
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
