import { CommandState } from '@app/features/command';
import { useViewTabHotkeys } from '@app/components/view-shell';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import {
  withSplitPanelOwner,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import {
  createListController,
  listOwnedSlotName,
  type ListScrollHandle,
  useListInteractions,
} from '@app/components/list';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { TabsInset } from '@core/component/TabsInset';
import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import type { MacroId } from '@core/user/macroId';
import { compareDateDesc, type DateValue } from '@core/util/date';
import { Entity, type ChannelEntity } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import ChannelIcon from '@icon/wide-channel.svg';
import ReplyIcon from '@phosphor/arrow-bend-up-left.svg';
import AtIcon from '@phosphor/at.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import ChatTeardropIcon from '@phosphor/chat-teardrop.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Key } from '@solid-primitives/keyed';
import { cn, Tooltip } from '@ui';
import { createMemo, createUniqueId, type JSX, Show } from 'solid-js';
import { useChannelsView } from '../channels-view-context';
import type { ChannelsGroup, ChannelsTab } from '../types';

function createTabLabel(label: string, icon: JSX.Element) {
  return (
    <>
      <span class="channels-slim:hidden">{label}</span>
      <span class="hidden channels-slim:block [&_svg]:size-4">{icon}</span>
    </>
  );
}

const CHANNEL_TABS = [
  {
    value: 'browse',
    label: createTabLabel('Browse', <ChatsIcon />),
  },
  {
    value: 'recents',
    label: createTabLabel('Recents', <ChatTextIcon />),
  },
];
const CHANNEL_TAB_IDS: ChannelsTab[] = ['browse', 'recents'];

type ChannelRailRow =
  | {
      kind: 'section';
      id: `section:${ChannelsGroup}`;
      group: ChannelsGroup;
    }
  | {
      kind: 'conversation';
      id: `channel:${string}`;
      group?: ChannelsGroup;
      channel: ChannelEntity;
    };

const sectionRow = (group: ChannelsGroup): ChannelRailRow => ({
  kind: 'section',
  id: `section:${group}`,
  group,
});

const conversationRow = (
  channel: ChannelEntity,
  group?: ChannelsGroup
): ChannelRailRow => ({
  kind: 'conversation',
  id: `channel:${channel.id}`,
  group,
  channel,
});

const rowKeyForChannel = (channelId: string) => `channel:${channelId}`;
const rowKeyForSection = (group: ChannelsGroup) => `section:${group}`;

function channelInitials(name: string) {
  const words = name.replace(/^#+/, '').trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return '?';

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toLocaleUpperCase();
}

function ChannelAvatar(props: { channel: ChannelEntity; size?: 'sm' | 'md' }) {
  const sizeClass = () =>
    props.size === 'md'
      ? cn(
          'size-9 [&_svg]:size-4.5',
          'channels-slim:size-6 channels-slim:[&_svg]:size-3.5'
        )
      : 'size-6 [&_svg]:size-3.5';

  return (
    <Show
      when={props.channel.channelType === 'direct_message'}
      fallback={
        <span
          class={cn(
            'flex shrink-0 items-center justify-center text-ink-muted [&_svg]:shrink-0',
            sizeClass()
          )}
        >
          <span class="flex size-full items-center justify-center channels-slim:hidden">
            <Entity.Icon
              entity={props.channel}
              suppressClick
              showTooltip={false}
            />
          </span>
          <span class="hidden size-full items-center justify-center rounded-full border border-edge bg-lift text-xxs font-semibold tracking-wide text-ink channels-slim:flex">
            {channelInitials(props.channel.name)}
          </span>
        </span>
      }
    >
      <span
        class={cn(
          'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-lift [&_img]:size-full [&_svg]:shrink-0',
          sizeClass()
        )}
      >
        <Entity.Icon entity={props.channel} suppressClick showTooltip={false} />
      </span>
    </Show>
  );
}

type ChannelOptionProps = {
  id: string;
  channel: ChannelEntity;
  unread: boolean;
  selected: boolean;
  focused: boolean;
  onActivate: () => void;
};

function ChannelOption(props: ChannelOptionProps) {
  return (
    <Tooltip
      label={props.channel.name}
      placement="right"
      class="w-full channels-slim:size-10"
    >
      <button
        id={props.id}
        type="button"
        role="treeitem"
        tabIndex={-1}
        class={cn(
          'relative flex w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
          'channels-slim:size-10 channels-slim:min-h-10 channels-slim:self-center channels-slim:justify-center channels-slim:rounded-full channels-slim:px-0 channels-slim:py-0',
          props.channel.channelType === 'direct_message'
            ? 'min-h-10 py-2'
            : 'h-8',
          props.selected
            ? 'bg-active text-ink'
            : props.focused
              ? 'bg-hover text-ink'
              : 'text-ink-muted hover:bg-hover hover:text-ink'
        )}
        aria-current={props.selected ? 'page' : undefined}
        onClick={props.onActivate}
      >
        <ChannelAvatar channel={props.channel} />
        <span class="min-w-0 flex-1 truncate text-sm font-medium channels-slim:hidden">
          {props.channel.name}
        </span>
        <Show when={props.unread}>
          <span
            aria-label="Unread"
            class={cn(
              'size-2 shrink-0 rounded-full bg-accent',
              'channels-slim:absolute channels-slim:right-1.5 channels-slim:top-1'
            )}
          />
        </Show>
      </button>
    </Tooltip>
  );
}

type ConversationCardProps = {
  id: string;
  channel: ChannelEntity;
  senderId?: string;
  mentionedCurrentUser: boolean;
  unread: boolean;
  selected: boolean;
  focused: boolean;
  showTooltip: boolean;
  onActivate: () => void;
};

function formatDetailedTimestamp(timestamp: DateValue) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function UserDisplayName(props: { id: MacroId }) {
  const [displayName] = useDisplayName(props.id, {
    emailFallback: 'local-part',
  });

  return <>{displayName()}</>;
}

function MessageSenderName(props: { id?: string }) {
  const currentUserId = useUserId();
  const macroId = () => (props.id ? tryMacroId(props.id) : undefined);
  const isCurrentUser = () =>
    props.id?.toLocaleLowerCase() === currentUserId()?.toLocaleLowerCase();

  return (
    <Show when={props.id} fallback={<>Unknown sender</>}>
      {(senderId) => (
        <Show when={!isCurrentUser()} fallback={<>You</>}>
          <Show
            when={macroId()}
            fallback={senderId().startsWith('bot|') ? 'Bot' : 'Someone'}
          >
            {(id) => <UserDisplayName id={id()} />}
          </Show>
        </Show>
      )}
    </Show>
  );
}

function ConversationCard(props: ConversationCardProps) {
  const latestRootMessage = () => props.channel.latestRootMessage;

  return (
    <Tooltip
      label={props.channel.name}
      placement="right"
      disabled={!props.showTooltip}
      class="w-full channels-slim:size-10 channels-slim:self-center"
    >
      <button
        id={props.id}
        type="button"
        role="treeitem"
        tabIndex={-1}
        class={cn(
          'w-full min-w-0 overflow-hidden px-2 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          'channels-slim:flex channels-slim:size-10 channels-slim:items-center channels-slim:justify-center channels-slim:rounded-full channels-slim:px-0 channels-slim:py-0',
          props.selected
            ? 'bg-active'
            : props.focused
              ? 'bg-hover'
              : 'bg-transparent hover:bg-hover'
        )}
        aria-current={props.selected ? 'page' : undefined}
        onClick={props.onActivate}
      >
        <div class="flex min-w-0 items-start gap-3 overflow-hidden channels-slim:justify-center">
          <div class="relative shrink-0">
            <ChannelAvatar channel={props.channel} size="md" />
            <Show when={props.unread}>
              <span
                aria-label="Unread"
                class="absolute -right-0.5 -top-0.5 hidden size-2 rounded-full bg-accent ring-2 ring-surface channels-slim:block"
              />
            </Show>
          </div>
          <div class="min-w-0 flex-1 overflow-hidden channels-slim:hidden">
            <span class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {props.channel.name}
              </span>
              <Show when={props.unread}>
                <span
                  aria-label="Unread"
                  class="size-2 shrink-0 rounded-full bg-accent"
                />
              </Show>
              <Show when={latestRootMessage()?.createdAt}>
                {(createdAt) => (
                  <Tooltip
                    label={formatDetailedTimestamp(createdAt())}
                    placement="top"
                  >
                    <span class="shrink-0 text-xxs text-ink-extra-muted">
                      <Entity.Timestamp
                        entity={props.channel}
                        overrideTimeStamp={createdAt()}
                      />
                    </span>
                  </Tooltip>
                )}
              </Show>
            </span>
            <Show
              when={latestRootMessage()?.threadId || props.mentionedCurrentUser}
            >
              <span class="flex min-w-0 items-center gap-2 text-xxs leading-4 text-ink-extra-muted">
                <Show when={latestRootMessage()?.threadId}>
                  <span
                    class="flex shrink-0 items-center gap-1"
                    title="Reply in thread"
                  >
                    <ReplyIcon class="size-3" />
                    <span>Reply</span>
                  </span>
                </Show>
                <Show when={props.mentionedCurrentUser}>
                  <span class="flex shrink-0 items-center gap-1 text-accent">
                    <AtIcon class="size-3" />
                    <span>Mentioned you</span>
                  </span>
                </Show>
              </span>
            </Show>
            <div class="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs leading-4">
              <span class="shrink-0 font-medium text-ink-muted">
                <MessageSenderName id={props.senderId} />:
              </span>
              <Show
                when={latestRootMessage()?.content.trim()}
                fallback={
                  <span class="min-w-0 flex-1 text-ink-extra-muted">
                    No messages yet
                  </span>
                }
              >
                {(content) => (
                  <div class="min-w-0 flex-1 truncate text-ink-muted [&_*]:my-0 [&_*]:truncate">
                    <StaticMarkdown markdown={content()} singleLine />
                  </div>
                )}
              </Show>
            </div>
          </div>
        </div>
      </button>
    </Tooltip>
  );
}

type CollapsibleSectionProps = {
  id: string;
  group: ChannelsGroup;
  title: string;
  narrowIcon: JSX.Element;
  unreadCount: number;
  focused: boolean;
  onActivate: () => void;
  action: () => JSX.Element;
  children: JSX.Element;
};

function CollapsibleSection(props: CollapsibleSectionProps) {
  const { state } = useChannelsView();
  const open = () => state.expandedGroups[props.group];

  return (
    <section class="flex flex-col gap-1 channels-slim:items-center">
      <div
        class={cn(
          'flex h-9 w-full items-center rounded-xl text-xs font-semibold uppercase tracking-wide text-ink-extra-muted transition-colors hover:bg-hover hover:text-ink-muted has-[[data-section-action]:hover]:bg-transparent has-[[data-section-action]:focus-within]:bg-transparent',
          'channels-slim:h-10 channels-slim:justify-center',
          props.focused && 'bg-hover text-ink-muted'
        )}
      >
        <button
          id={props.id}
          type="button"
          role="treeitem"
          tabIndex={-1}
          class={cn(
            'relative flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'channels-slim:size-10 channels-slim:min-w-10 channels-slim:flex-none channels-slim:justify-center channels-slim:rounded-full channels-slim:px-0'
          )}
          aria-expanded={open()}
          onClick={props.onActivate}
        >
          <CaretDownIcon
            class={cn(
              'size-3 shrink-0 transition-transform channels-slim:hidden',
              !open() && '-rotate-90'
            )}
          />
          <span class="min-w-0 flex-1 truncate channels-slim:hidden">
            {props.title}
          </span>
          <span class="hidden items-center justify-center channels-slim:flex [&_svg]:size-4">
            {props.narrowIcon}
          </span>
          <Show when={props.unreadCount > 0}>
            <span
              class={cn(
                'text-xxs tabular-nums',
                'channels-slim:absolute channels-slim:right-0.5 channels-slim:top-0'
              )}
            >
              {props.unreadCount}
            </span>
          </Show>
        </button>
        <div data-section-action="" class="pr-1 channels-slim:hidden">
          {props.action()}
        </div>
      </div>
      <div class="hidden w-full px-2 channels-slim:block">
        <div class="border-t border-edge-muted" />
      </div>
      <Show when={open()}>
        <div class="flex flex-col gap-0.5 channels-slim:w-full channels-slim:items-center">
          <div class="hidden justify-center channels-slim:flex">
            {props.action()}
          </div>
          {props.children}
        </div>
      </Show>
    </section>
  );
}

/** V2 Chat navigation rail with Browse and Recents destinations. */
export function ChannelsRail(props: {
  channels: ChannelEntity[];
  mode: 'full' | 'slim';
}) {
  const { state, setGroupOpen, setSelectedChannelId, setTab } =
    useChannelsView();
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const currentUserId = useUserId();
  const notificationSource = useGlobalNotificationSource();
  const listDomId = createUniqueId();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => CHANNEL_TAB_IDS,
    activeId: () => state.tab,
    setActiveId: setTab,
  });

  const unreadChannelIds = createMemo(() => {
    const ids = new Set<string>();

    for (const notification of notificationSource.notifications()) {
      if (
        notification.entity_type === 'channel' &&
        !notificationIsRead(notification)
      ) {
        ids.add(notification.entity_id);
      }
    }

    return ids;
  });

  const teamChannels = createMemo(() =>
    props.channels.filter((channel) => channel.channelType !== 'direct_message')
  );
  const directMessages = createMemo(() =>
    props.channels.filter((channel) => channel.channelType === 'direct_message')
  );
  const unreadTeamChannelCount = createMemo(
    () =>
      teamChannels().filter((channel) => unreadChannelIds().has(channel.id))
        .length
  );
  const unreadDirectMessageCount = createMemo(
    () =>
      directMessages().filter((channel) => unreadChannelIds().has(channel.id))
        .length
  );
  const recentConversations = createMemo(() =>
    props.channels
      .filter((channel) => channel.latestRootMessage)
      .sort((a, b) =>
        compareDateDesc(
          a.latestRootMessage?.createdAt,
          b.latestRootMessage?.createdAt
        )
      )
  );
  const visibleRows = createMemo<ChannelRailRow[]>(() => {
    if (state.tab === 'recents') {
      return recentConversations().map((channel) => conversationRow(channel));
    }

    const rows: ChannelRailRow[] = [sectionRow('channels')];
    if (state.expandedGroups.channels) {
      rows.push(
        ...teamChannels().map((channel) => conversationRow(channel, 'channels'))
      );
    }

    rows.push(sectionRow('direct-messages'));
    if (state.expandedGroups['direct-messages']) {
      rows.push(
        ...directMessages().map((channel) =>
          conversationRow(channel, 'direct-messages')
        )
      );
    }

    return rows;
  });

  async function focusChannelInput(channelId: string) {
    const handle = await orchestrator.getBlockHandle(channelId, 'channel');
    await handle?.focusInput();
  }

  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<ChannelRailRow>({
      items: visibleRows,
      getKey: (row) => row.id,
      isSelectable: () => false,
      initialFocusKey:
        state.selectedChannelId === undefined
          ? undefined
          : rowKeyForChannel(state.selectedChannelId),
      onActivate: ({ item, reason }) => {
        if (item.kind === 'section') {
          setGroupOpen(item.group, !state.expandedGroups[item.group]);
          return;
        }

        setSelectedChannelId(item.channel.id);
        if (reason === 'keyboard') {
          void focusChannelInput(item.channel.id);
        }
      },
    })
  );

  const domIdForRow = (rowId: string) => `${listDomId}-${rowId}`;
  let listRoot: HTMLDivElement | undefined;
  const scrollHandle: ListScrollHandle = {
    scrollToIndex: (index) => {
      const row = list.items.at(index);
      if (!row) return;

      document
        .getElementById(domIdForRow(row.id))
        ?.scrollIntoView({ block: 'nearest' });
    },
  };

  withSplitPanelOwner(listOwnedSlotName('navigation-hotkeys'), () =>
    useListInteractions({
      controller: list,
      scopeId: panel.splitHotkeyScope,
      scrollHandle: () => scrollHandle,
      enabled: panel.isPanelActive,
      navigation: {
        onNavigate: (event) => {
          listRoot?.focus({ preventScroll: true });

          const row = event.result?.item;
          if (row?.kind === 'conversation') {
            setSelectedChannelId(row.channel.id);
          }
        },
      },
      disclosure: {
        getKey: (row) => row.group,
        isExpanded: (group) => state.expandedGroups[group as ChannelsGroup],
        setExpanded: (group, expanded) =>
          setGroupOpen(group as ChannelsGroup, expanded),
        getFocusKey: (group) => rowKeyForSection(group as ChannelsGroup),
      },
    })
  );

  const mentionsCurrentUser = (channel: ChannelEntity) => {
    const userId = currentUserId()?.toLocaleLowerCase();

    return Boolean(
      userId &&
        channel.latestRootMessage?.mentions.some(
          (mention) => mention.toLocaleLowerCase() === userId
        )
    );
  };
  const activateRow = (rowId: string) => {
    list.activate.key(rowId, { reason: 'pointer' });
  };
  const activeDescendant = () => {
    const rowId = list.focus.key();
    return rowId === undefined ? undefined : domIdForRow(rowId);
  };

  const createChannelAction = () => (
    <button
      type="button"
      class={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent',
        'channels-slim:size-10 channels-slim:rounded-full channels-slim:border channels-slim:border-edge-muted channels-slim:bg-transparent'
      )}
      aria-label="Create channel"
      onClick={() => openNewChannelModal()}
    >
      <PlusIcon class="size-3.5" />
    </button>
  );
  const createDirectMessageAction = () => (
    <button
      type="button"
      class={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent',
        'channels-slim:size-10 channels-slim:rounded-full channels-slim:border channels-slim:border-edge-muted channels-slim:bg-transparent'
      )}
      aria-label="Start direct message"
      onClick={() => {
        CommandState.clearQuery();
        CommandState.setCategoryFilter('dms');
        CommandState.open();
      }}
    >
      <PlusIcon class="size-3.5" />
    </button>
  );

  return (
    <aside
      aria-label="Chat navigation"
      data-channels-rail={props.mode}
      class="flex size-full min-h-0 flex-col bg-inset pb-5 pt-2"
    >
      <div class="flex min-h-8 shrink-0 items-center px-4 channels-slim:hidden">
        <SplitPanel.ControlGroup>
          <SplitPanel.CloseButton />
          <SplitPanel.BackButton />
          <SplitPanel.ForwardButton />
        </SplitPanel.ControlGroup>
      </div>
      <div class="flex shrink-0 items-center px-4 pt-3 channels-slim:hidden">
        <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
          Chat
        </h1>
      </div>

      <div
        class={cn(
          'shrink-0 px-4 pt-3',
          'channels-slim:px-3 channels-slim:pt-0'
        )}
      >
        <TabsInset
          aria-label="Chat sidebar views"
          class="h-9 channels-slim:h-[76px]"
          trackClass="h-full channels-slim:flex-col"
          itemClass="h-full channels-slim:h-auto channels-slim:min-h-0 channels-slim:w-full"
          labelClass="h-full py-0 channels-slim:size-full channels-slim:p-0"
          fullWidth
          list={CHANNEL_TABS}
          value={state.tab}
          onChange={(value) => {
            if (value !== 'browse' && value !== 'recents') return;

            setTab(value);
          }}
        />
      </div>

      <div
        ref={(element) => {
          listRoot = element;
        }}
        role="tree"
        tabIndex={-1}
        aria-activedescendant={activeDescendant()}
        class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pt-3 outline-none"
      >
        <Show
          when={state.tab === 'browse'}
          fallback={
            <Show
              when={recentConversations().length > 0}
              fallback={
                <div class="px-3 py-8 text-center text-sm text-ink-extra-muted channels-slim:hidden">
                  No recent messages
                </div>
              }
            >
              <div class="flex w-full flex-col divide-y divide-edge-muted channels-slim:gap-0.5 channels-slim:divide-y-0">
                <Key each={recentConversations()} by={(channel) => channel.id}>
                  {(channel) => (
                    <ConversationCard
                      id={domIdForRow(rowKeyForChannel(channel().id))}
                      channel={channel()}
                      senderId={channel().latestRootMessage?.senderId}
                      mentionedCurrentUser={mentionsCurrentUser(channel())}
                      unread={unreadChannelIds().has(channel().id)}
                      selected={state.selectedChannelId === channel().id}
                      focused={
                        list.focus.key() === rowKeyForChannel(channel().id)
                      }
                      showTooltip={props.mode === 'slim'}
                      onActivate={() =>
                        activateRow(rowKeyForChannel(channel().id))
                      }
                    />
                  )}
                </Key>
              </div>
            </Show>
          }
        >
          <div class="flex flex-col gap-3 px-4 channels-slim:px-2">
            <CollapsibleSection
              id={domIdForRow(rowKeyForSection('channels'))}
              group="channels"
              title="Channels"
              narrowIcon={<ChannelIcon />}
              unreadCount={unreadTeamChannelCount()}
              focused={list.focus.key() === rowKeyForSection('channels')}
              onActivate={() => activateRow(rowKeyForSection('channels'))}
              action={createChannelAction}
            >
              <Show
                when={teamChannels().length > 0}
                fallback={
                  <div class="px-2 py-2 text-xs text-ink-extra-muted channels-slim:hidden">
                    No channels
                  </div>
                }
              >
                <Key each={teamChannels()} by={(channel) => channel.id}>
                  {(channel) => (
                    <ChannelOption
                      id={domIdForRow(rowKeyForChannel(channel().id))}
                      channel={channel()}
                      unread={unreadChannelIds().has(channel().id)}
                      selected={state.selectedChannelId === channel().id}
                      focused={
                        list.focus.key() === rowKeyForChannel(channel().id)
                      }
                      onActivate={() =>
                        activateRow(rowKeyForChannel(channel().id))
                      }
                    />
                  )}
                </Key>
              </Show>
            </CollapsibleSection>

            <CollapsibleSection
              id={domIdForRow(rowKeyForSection('direct-messages'))}
              group="direct-messages"
              title="DMs"
              narrowIcon={<ChatTeardropIcon />}
              unreadCount={unreadDirectMessageCount()}
              focused={list.focus.key() === rowKeyForSection('direct-messages')}
              onActivate={() =>
                activateRow(rowKeyForSection('direct-messages'))
              }
              action={createDirectMessageAction}
            >
              <Show
                when={directMessages().length > 0}
                fallback={
                  <div class="px-2 py-2 text-xs text-ink-extra-muted channels-slim:hidden">
                    No direct messages
                  </div>
                }
              >
                <Key each={directMessages()} by={(channel) => channel.id}>
                  {(channel) => (
                    <ChannelOption
                      id={domIdForRow(rowKeyForChannel(channel().id))}
                      channel={channel()}
                      unread={unreadChannelIds().has(channel().id)}
                      selected={state.selectedChannelId === channel().id}
                      focused={
                        list.focus.key() === rowKeyForChannel(channel().id)
                      }
                      onActivate={() =>
                        activateRow(rowKeyForChannel(channel().id))
                      }
                    />
                  )}
                </Key>
              </Show>
            </CollapsibleSection>
          </div>
        </Show>
      </div>
    </aside>
  );
}
