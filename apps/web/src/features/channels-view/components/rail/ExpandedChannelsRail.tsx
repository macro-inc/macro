import { runCreateAction } from '@app/features/command/Launcher';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { SplitPanel } from '@components/app/split-panel';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ChannelEntity } from '@entity';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { Key } from '@solid-primitives/keyed';
import { cn, Hotkey, Tabs } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { ChannelsGroup } from '../../types';
import { channelMentionsUser, isDirectMessage } from '../../utils';
import { ChannelsEmptyState } from '../ChannelsEmptyState';
import {
  ChannelAvatar,
  ChannelCallIndicator,
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
  RailModeButton,
} from './ChannelsRailSection';
import {
  useChannelRailItemState,
  useChannelRailSectionState,
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
    <div
      id={item().domId}
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'relative flex w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent touch:focus-visible:ring-0',
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
  const { state: section, clearVisibleActivity } = useChannelRailSectionState(
    () => props.config.group
  );
  const registerScrollRef = (element: HTMLDivElement) =>
    rail.registerScrollRef(props.config.group, element);

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
          class="relative flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          <Match when={section().items.length > 0}>
            <Key each={section().items} by={(channel) => channel.id}>
              {(channel) => <ChannelOption channel={channel()} />}
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

function ExpandedBrowse() {
  const rail = useChannelsRail();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
  const hasItems = () =>
    rail.teamChannels().length > 0 || rail.directMessages().length > 0;

  return (
    <Switch>
      <Match when={forceEmptyState() || !hasItems()}>
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
    <ConversationCard
      id={item().domId}
      channel={props.channel}
      senderId={props.channel.latestRootMessage?.senderId}
      mentionedCurrentUser={channelMentionsUser(props.channel, currentUserId())}
      unread={item().unread}
      callStatus={item().callStatus}
      incomingCallId={item().incomingCallId}
      selected={item().selected}
      focused={item().focused}
      onActivate={() => rail.activateRow(rowKeyForChannel(props.channel.id))}
    />
  );
}

function ExpandedRecents() {
  const rail = useChannelsRail();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
  const hasItems = () =>
    !forceEmptyState() && rail.recentConversations().length > 0;

  return (
    <Switch>
      <Match when={!hasItems()}>
        <ChannelsEmptyState scope="recents" topAligned />
      </Match>
      <Match when={true}>
        <div class="flex w-full flex-col divide-y divide-edge-muted">
          <Key each={rail.recentConversations()} by={(channel) => channel.id}>
            {(channel) => <RecentConversationCard channel={channel()} />}
          </Key>
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
          class={cn(
            'scrollbar-hidden min-h-0 flex-1 outline-none',
            rail.tab() === 'browse' ? 'overflow-hidden' : 'overflow-y-auto'
          )}
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
