import { runCreateAction } from '@app/features/command/Launcher';
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
import { type Component, For, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn, Dropdown, Tabs, Tooltip } from '@ui';
import type { ChannelsGroup } from '../../types';
import { channelInitials, isDirectMessage } from '../../utils';
import {
  ChannelCallIndicator,
  type ChannelRailItemProps,
} from './ChannelRailItems';
import { CollapsibleSection, RailModeButton } from './ChannelsRailSection';
import type { ChannelsRailController } from './useChannelsRailController';

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

function SlimChannelItem(props: ChannelRailItemProps) {
  return (
    <Tooltip
      label={props.channel.name}
      placement="right"
      class="size-10 self-center"
    >
      <button
        id={props.id}
        type="button"
        role="treeitem"
        tabIndex={-1}
        class={cn(
          'flex size-10 items-center justify-center rounded-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent touch:focus-visible:ring-0',
          props.selected && !isTouchDevice() && 'bg-active text-ink',
          (!props.selected || isTouchDevice()) && 'text-ink-muted',
          !props.selected &&
            !isTouchDevice() &&
            props.focused &&
            'bg-hover text-ink',
          !props.selected &&
            !isTouchDevice() &&
            !props.focused &&
            'hover:bg-hover hover:text-ink'
        )}
        aria-current={props.selected ? 'page' : undefined}
        onClick={props.onActivate}
      >
        <span class="relative">
          <SlimChannelAvatar channel={props.channel} />
          <ChannelCallIndicator
            status={props.callStatus}
            class="absolute -bottom-0.5 -right-0.5 rounded-full bg-inset p-0.5"
          />
          <Show when={props.unread}>
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

function SlimHeader(props: {
  rail: ChannelsRailController;
  onExpand: () => void;
}) {
  const selectTab = (value: string) => {
    if (value === 'browse' || value === 'recents') {
      props.rail.selectTab(value);
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
        <RailModeButton expanded={false} onToggle={props.onExpand} />
      </div>
      <div class="w-full px-3">
        <Tabs
          aria-label="Chat sidebar views"
          class="h-[76px] flex-col"
          itemClass="h-auto min-h-0 w-full"
          labelClass="size-full p-0"
          fullWidth
          list={SLIM_CHANNEL_TABS}
          value={props.rail.tab()}
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

function SlimGroupSection(props: {
  rail: ChannelsRailController;
  config: GroupConfig;
}) {
  const group = () => props.config.group;
  const channels = () => props.rail.group.items(group());

  return (
    <CollapsibleSection.Root
      open={props.rail.group.isOpen(group())}
      fillAvailable={
        group() === 'direct_messages' && !props.rail.group.isOpen('channels')
      }
      class="items-center"
    >
      <CollapsibleSection.Header
        focused={props.rail.group.isFocused(group())}
        focusWithin={props.rail.group.containsFocus(group())}
        class="h-10 justify-center"
      >
        <button
          id={props.rail.group.domId(group())}
          type="button"
          role="treeitem"
          tabIndex={-1}
          class="relative flex size-10 min-w-10 flex-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={props.rail.group.isOpen(group())}
          aria-label={props.config.label}
          onClick={() => props.rail.group.activate(group())}
        >
          <span class="flex items-center justify-center [&_svg]:size-4">
            <Dynamic component={props.config.icon} />
          </span>
          <Show when={props.rail.group.unreadCount(group()) > 0}>
            <span class="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none text-accent-contrast ring-2 ring-surface">
              {props.rail.group.unreadCount(group())}
            </span>
          </Show>
        </button>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content
        open={props.rail.group.isOpen(group())}
        contentRef={props.rail.group.scrollRef(group())}
        containerClass="w-full"
        class="flex min-h-0 w-full flex-col items-center gap-0.5"
        activityTargetId={props.rail.group.activityTargetId(group())}
        activityTooltip
        onActivityVisible={(targetId) =>
          props.rail.group.activityVisible(group(), targetId)
        }
      >
        <Show when={!props.rail.forceEmptyState()}>
          <Key each={channels()} by={(channel) => channel.id}>
            {(channel) => (
              <SlimChannelItem
                id={props.rail.channel.domId(channel().id)}
                channel={channel()}
                unread={props.rail.channel.isUnread(channel().id)}
                callStatus={props.rail.channel.callStatus(channel().id)}
                selected={props.rail.channel.isSelected(channel().id)}
                focused={props.rail.channel.isFocused(channel().id)}
                onActivate={() => props.rail.channel.activate(channel().id)}
              />
            )}
          </Key>
        </Show>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

function SlimBrowse(props: { rail: ChannelsRailController }) {
  return (
    <div class="flex h-full min-h-0 flex-col gap-3 px-2">
      <For each={GROUPS}>
        {(config) => <SlimGroupSection rail={props.rail} config={config} />}
      </For>
    </div>
  );
}

function SlimRecents(props: { rail: ChannelsRailController }) {
  const hasItems = () =>
    !props.rail.forceEmptyState() &&
    props.rail.recentConversations().length > 0;

  return (
    <Show when={hasItems()}>
      <div class="flex w-full flex-col gap-0.5">
        <Key
          each={props.rail.recentConversations()}
          by={(channel) => channel.id}
        >
          {(channel) => (
            <SlimChannelItem
              id={props.rail.channel.domId(channel().id)}
              channel={channel()}
              unread={props.rail.channel.isUnread(channel().id)}
              callStatus={props.rail.channel.callStatus(channel().id)}
              selected={props.rail.channel.isSelected(channel().id)}
              focused={props.rail.channel.isFocused(channel().id)}
              onActivate={() => props.rail.channel.activate(channel().id)}
            />
          )}
        </Key>
      </div>
    </Show>
  );
}

export function SlimChannelsRail(props: {
  rail: ChannelsRailController;
  onExpand: () => void;
}) {
  return (
    <>
      <SlimHeader rail={props.rail} onExpand={props.onExpand} />
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          ref={props.rail.root.ref}
          role="tree"
          tabIndex={-1}
          aria-activedescendant={props.rail.root.activeDescendant()}
          class={cn(
            'scrollbar-hidden min-h-0 flex-1 outline-none',
            props.rail.tab() === 'browse'
              ? 'overflow-hidden'
              : 'overflow-y-auto'
          )}
        >
          <Switch>
            <Match when={props.rail.tab() === 'browse'}>
              <SlimBrowse rail={props.rail} />
            </Match>
            <Match when={props.rail.tab() === 'recents'}>
              <SlimRecents rail={props.rail} />
            </Match>
          </Switch>
        </div>
      </div>
    </>
  );
}
