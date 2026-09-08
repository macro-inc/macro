import { runCreateAction } from '@app/features/command/Launcher';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { Key } from '@solid-primitives/keyed';
import { cn, Hotkey, Tabs } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { ChannelsGroup } from '../../types';
import { isDirectMessage } from '../../utils';
import { ChannelsEmptyState } from '../ChannelsEmptyState';
import {
  ChannelAvatar,
  ChannelCallIndicator,
  type ChannelRailItemProps,
  ConversationCard,
  IncomingCallActions,
} from './ChannelRailItems';
import {
  CollapsibleSection,
  CreateRailAction,
  RailModeButton,
} from './ChannelsRailSection';
import type { ChannelsRailController } from './useChannelsRailController';

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

function selectTab(rail: ChannelsRailController, value: string) {
  if (value === 'browse' || value === 'recents') {
    rail.selectTab(value);
  }
}

function ChannelOption(props: ChannelRailItemProps) {
  return (
    <div
      id={props.id}
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'relative flex w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent touch:focus-visible:ring-0',
        isDirectMessage(props.channel) ? 'min-h-10 py-2' : 'h-8',
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
      <ChannelAvatar channel={props.channel} />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {props.channel.name}
      </span>
      <ChannelCallIndicator
        status={props.incomingCallId ? undefined : props.callStatus}
      />
      <IncomingCallActions
        callId={props.incomingCallId}
        channelId={props.channel.id}
      />
      <Show when={props.unread}>
        <span
          aria-label="Unread"
          class="size-2 shrink-0 rounded-full bg-accent"
        />
      </Show>
    </div>
  );
}

function ExpandedHeader(props: {
  rail: ChannelsRailController;
  onCollapse: () => void;
}) {
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
        <RailModeButton expanded onToggle={props.onCollapse} />
        <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
          Chat
        </h1>
      </div>
      <Tabs
        aria-label="Chat sidebar views"
        fullWidth
        list={CHANNEL_TABS}
        value={props.rail.tab()}
        onChange={(value) => selectTab(props.rail, value)}
      />
    </div>
  );
}

function ExpandedGroupSection(props: {
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
    >
      <CollapsibleSection.Header
        focused={props.rail.group.isFocused(group())}
        focusWithin={props.rail.group.containsFocus(group())}
        class="h-9 has-[[data-section-action]:hover]:bg-transparent has-[[data-section-action]:focus-within]:bg-transparent"
      >
        <button
          id={props.rail.group.domId(group())}
          type="button"
          role="treeitem"
          tabIndex={-1}
          class="relative flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={props.rail.group.isOpen(group())}
          onClick={() => props.rail.group.activate(group())}
        >
          <CaretDownIcon
            class={cn(
              'size-3 shrink-0 transition-transform',
              !props.rail.group.isOpen(group()) && '-rotate-90'
            )}
          />
          <span class="min-w-0 truncate">{props.config.label}</span>
          <Show when={props.rail.group.unreadCount(group()) > 0}>
            <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none tabular-nums text-accent-contrast">
              {props.rail.group.unreadCount(group())}
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
        open={props.rail.group.isOpen(group())}
        contentRef={props.rail.group.scrollRef(group())}
        class="flex min-h-0 flex-col gap-0.5"
        activityTargetId={props.rail.group.activityTargetId(group())}
        activityLabel={props.rail.group.activityLabel(group())}
        onActivityVisible={(targetId) =>
          props.rail.group.activityVisible(group(), targetId)
        }
      >
        <Switch>
          <Match when={!props.rail.forceEmptyState() && channels().length > 0}>
            <Key each={channels()} by={(channel) => channel.id}>
              {(channel) => (
                <ChannelOption
                  id={props.rail.channel.domId(channel().id)}
                  channel={channel()}
                  unread={props.rail.channel.isUnread(channel().id)}
                  callStatus={props.rail.channel.callStatus(channel().id)}
                  incomingCallId={props.rail.channel.incomingCallId(
                    channel().id
                  )}
                  selected={props.rail.channel.isSelected(channel().id)}
                  focused={props.rail.channel.isFocused(channel().id)}
                  onActivate={() => props.rail.channel.activate(channel().id)}
                />
              )}
            </Key>
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

function ExpandedBrowse(props: { rail: ChannelsRailController }) {
  const hasItems = () =>
    props.rail.group.items('channels').length > 0 ||
    props.rail.group.items('direct_messages').length > 0;

  return (
    <Switch>
      <Match when={props.rail.forceEmptyState() || !hasItems()}>
        <ChannelsEmptyState scope="channels" topAligned />
      </Match>
      <Match when={true}>
        <div class="flex h-full min-h-0 flex-col gap-3 px-4">
          <For each={GROUPS}>
            {(config) => (
              <ExpandedGroupSection rail={props.rail} config={config} />
            )}
          </For>
        </div>
      </Match>
    </Switch>
  );
}

function ExpandedRecents(props: { rail: ChannelsRailController }) {
  const hasItems = () =>
    !props.rail.forceEmptyState() &&
    props.rail.recentConversations().length > 0;

  return (
    <Switch>
      <Match when={!hasItems()}>
        <ChannelsEmptyState scope="recents" topAligned />
      </Match>
      <Match when={true}>
        <div class="flex w-full flex-col divide-y divide-edge-muted">
          <Key
            each={props.rail.recentConversations()}
            by={(channel) => channel.id}
          >
            {(channel) => (
              <ConversationCard
                id={props.rail.channel.domId(channel().id)}
                channel={channel()}
                senderId={channel().latestRootMessage?.senderId}
                mentionedCurrentUser={props.rail.mentionsCurrentUser(channel())}
                unread={props.rail.channel.isUnread(channel().id)}
                callStatus={props.rail.channel.callStatus(channel().id)}
                incomingCallId={props.rail.channel.incomingCallId(channel().id)}
                selected={props.rail.channel.isSelected(channel().id)}
                focused={props.rail.channel.isFocused(channel().id)}
                onActivate={() => props.rail.channel.activate(channel().id)}
              />
            )}
          </Key>
        </div>
      </Match>
    </Switch>
  );
}

export function ExpandedChannelsRail(props: {
  rail: ChannelsRailController;
  onCollapse: () => void;
}) {
  return (
    <>
      <ExpandedHeader rail={props.rail} onCollapse={props.onCollapse} />
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
              <ExpandedBrowse rail={props.rail} />
            </Match>
            <Match when={props.rail.tab() === 'recents'}>
              <ExpandedRecents rail={props.rail} />
            </Match>
          </Switch>
        </div>
        <Show when={props.rail.tab() === 'browse'}>
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
