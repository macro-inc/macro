import { runCreateAction } from '@app/features/command/Launcher';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ChannelEntity, Entity } from '@entity';
import ChannelIcon from '@icon/wide-channel.svg';
import ChatTeardropIcon from '@phosphor/chat-teardrop.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Key } from '@solid-primitives/keyed';
import { cn, Dropdown, Tabs, Tooltip } from '@ui';
import { type Component, For, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ChannelsGroup } from '../../types';
import { channelInitials, isDirectMessage } from '../../utils';
import { ChannelCallIndicator } from './ChannelRailItems';
import {
  domIdForRow,
  rowKeyForChannel,
  rowKeyForSection,
  useChannelsRail,
} from './ChannelsRailContext';
import { CollapsibleSection, RailModeButton } from './ChannelsRailSection';
import {
  useChannelRailItemState,
  useChannelRailSectionState,
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
    <Tooltip
      label={props.channel.name}
      placement="right"
      class="size-10 self-center"
    >
      <button
        id={item().domId}
        type="button"
        role="treeitem"
        tabIndex={-1}
        class={cn(
          'flex size-10 items-center justify-center rounded-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent touch:focus-visible:ring-0',
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
        <span class="relative">
          <SlimChannelAvatar channel={props.channel} />
          <ChannelCallIndicator
            status={item().callStatus}
            class="absolute -bottom-0.5 -right-0.5 rounded-full bg-inset p-0.5"
          />
          <Show when={item().unread}>
            <span
              aria-label="Unread"
              class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-surface"
            />
          </Show>
        </span>
      </button>
    </Tooltip>
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
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
  const { state: section, clearVisibleActivity } = useChannelRailSectionState(
    () => props.config.group
  );
  const registerScrollRef = (element: HTMLDivElement) =>
    rail.registerScrollRef(props.config.group, element);

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
          class="relative flex size-10 min-w-10 flex-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={section().open}
          aria-label={props.config.label}
          onClick={() => rail.activateRow(rowKeyForSection(props.config.group))}
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
        <Show when={!forceEmptyState()}>
          <Key each={section().items} by={(channel) => channel.id}>
            {(channel) => <SlimChannelItem channel={channel()} />}
          </Key>
        </Show>
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
  const rail = useChannelsRail();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
  const hasItems = () =>
    !forceEmptyState() && rail.recentConversations().length > 0;

  return (
    <Show when={hasItems()}>
      <div class="flex w-full flex-col gap-0.5">
        <Key each={rail.recentConversations()} by={(channel) => channel.id}>
          {(channel) => <SlimChannelItem channel={channel()} />}
        </Key>
      </div>
    </Show>
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
          class={cn(
            'scrollbar-hidden min-h-0 flex-1 outline-none',
            rail.tab() === 'browse' ? 'overflow-hidden' : 'overflow-y-auto'
          )}
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
