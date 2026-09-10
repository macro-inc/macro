import { runCreateAction } from '@app/features/command/Launcher';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ChannelEntity, Entity } from '@entity';
import ChannelIcon from '@icon/wide-channel.svg';
import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import ChatTeardropIcon from '@phosphor/chat-teardrop.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, cn, Dropdown, Tabs, Tooltip } from '@ui';
import {
  type Component,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Virtualizer } from 'virtua/solid';
import type { ChannelsGroup } from '../../types';
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
  rowKeyForSection,
  useChannelsRail,
} from './ChannelsRailContext';
import {
  CollapsibleSection,
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

function BrowseTabLabel() {
  return (
    <>
      <span class="sr-only">Browse</span>
      <span aria-hidden="true" class="[&_svg]:size-4">
        <ChatsIcon />
      </span>
    </>
  );
}

function RecentsTabLabel() {
  return (
    <>
      <span class="sr-only">Recents</span>
      <span aria-hidden="true" class="[&_svg]:size-4">
        <ChatTextIcon />
      </span>
    </>
  );
}

const SLIM_CHANNEL_TABS = [
  { value: 'browse', label: BrowseTabLabel },
  { value: 'recents', label: RecentsTabLabel },
];

type GroupConfig = {
  group: ChannelsGroup;
  label: string;
  icon: Component;
};

const GROUPS: GroupConfig[] = [
  { group: 'channels', label: 'Channels', icon: ChannelIcon },
  {
    group: 'direct_messages',
    label: 'DMs',
    icon: ChatTeardropIcon,
  },
];

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
    <div class="flex shrink-0 flex-col items-center gap-3">
      <div class="flex w-full items-center justify-center px-2">
        <SplitPanel.ControlGroup>
          <SplitPanel.CloseButton size="icon-sm" />
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

function SlimGroupSection(props: { config: GroupConfig }) {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
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
      class="items-center"
    >
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
          aria-label={props.config.label}
          onMouseDown={(event) => {
            if (!isPrimaryMouseDown(event)) return;
            rail.activateRow(rowKeyForSection(props.config.group));
          }}
        >
          <span class="flex items-center justify-center [&_svg]:size-4">
            <Dynamic component={props.config.icon} />
          </span>
          <Show when={section().unreadCount > 0}>
            <span class="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none text-accent-contrast ring-2 ring-surface">
              {section().unreadCount}
            </span>
          </Show>
        </button>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content
        open={section().open}
        contentRef={registerScrollRef}
        containerClass="w-full"
        class="flex min-h-0 w-full flex-col items-center gap-0.5"
        activityTargetId={section().targetId}
        activityTooltip
        onActivityVisible={clearVisibleActivity}
      >
        <Switch>
          <Match when={forceEmptyState()}>{null}</Match>
          <Match
            when={section().source.isLoading() && section().items.length === 0}
          >
            <RailListLoading />
          </Match>
          <Match
            when={section().source.error() && section().items.length === 0}
          >
            <SlimListError retry={section().source.refresh} />
          </Match>
          <Match when={section().items.length > 0}>
            <Virtualizer
              ref={pagination.registerVirtualizer}
              data={section().items}
              scrollRef={scrollRoot()}
              itemSize={42}
              bufferSize={240}
              keepMounted={section().keepMounted}
              onScroll={pagination.loadMoreNearEnd}
            >
              {(channel) => (
                <div class="flex justify-center pb-0.5">
                  <SlimChannelItem channel={channel} />
                </div>
              )}
            </Virtualizer>
            <Show when={section().source.isLoadingMore()}>
              <RailListLoadingMore variant="slim" />
            </Show>
            <Show
              when={
                section().source.error() && !section().source.isLoadingMore()
              }
            >
              <SlimListError retry={section().source.refresh} />
            </Show>
          </Match>
        </Switch>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

function SlimBrowse() {
  return (
    <div class="flex h-full min-h-0 flex-col gap-3 px-2">
      <For each={GROUPS}>
        {(config) => <SlimGroupSection config={config} />}
      </For>
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
    </>
  );
}
