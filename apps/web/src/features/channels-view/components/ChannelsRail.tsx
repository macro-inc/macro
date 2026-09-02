import {
  createListController,
  type ListScrollHandle,
  listOwnedSlotName,
  useListInteractions,
} from '@app/components/list';
import { useViewTabHotkeys } from '@app/components/view-shell';
import { CommandState } from '@app/features/command';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { TabsInset } from '@core/component/TabsInset';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { useUserId } from '@core/context/user';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { tryMacroId, useDisplayName } from '@core/user';
import type { MacroId } from '@core/user/macroId';
import { compareDateDesc, type DateValue } from '@core/util/date';
import { Entity, type ChannelEntity } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import ChannelIcon from '@icon/wide-channel.svg';
import ReplyIcon from '@phosphor/arrow-bend-up-left.svg';
import AtIcon from '@phosphor/at.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ChatTeardropIcon from '@phosphor/chat-teardrop.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Key } from '@solid-primitives/keyed';
import { cn, Scroll, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { useChannelsView } from '../channels-view-context';
import type { ChannelsGroup, ChannelsTab } from '../types';

const CHANNEL_TABS = [
  {
    value: 'browse',
    label: 'Browse',
  },
  {
    value: 'recents',
    label: 'Recents',
  },
];
const SLIM_CHANNEL_TABS = [
  {
    value: 'browse',
    label: (
      <>
        <span class="sr-only">Browse</span>
        <span aria-hidden="true" class="[&_svg]:size-4">
          <ChatsIcon />
        </span>
      </>
    ),
  },
  {
    value: 'recents',
    label: (
      <>
        <span class="sr-only">Recents</span>
        <span aria-hidden="true" class="[&_svg]:size-4">
          <ChatTextIcon />
        </span>
      </>
    ),
  },
];
const CHANNEL_TAB_IDS: ChannelsTab[] = ['browse', 'recents'];
const CHANNEL_GROUPS: ChannelsGroup[] = ['channels', 'direct_messages'];

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
    props.size === 'md' ? 'size-9 [&_svg]:size-4.5' : 'size-6 [&_svg]:size-3.5';

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
          <Entity.Icon
            entity={props.channel}
            suppressClick
            showTooltip={false}
          />
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

function SlimChannelAvatar(props: { channel: ChannelEntity }) {
  return (
    <Show
      when={props.channel.channelType === 'direct_message'}
      fallback={
        <span class="flex size-6 shrink-0 items-center justify-center rounded-full border border-edge bg-lift text-xxs font-semibold tracking-wide text-ink">
          {channelInitials(props.channel.name)}
        </span>
      }
    >
      <span class="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-lift [&_img]:size-full [&_svg]:size-3.5 [&_svg]:shrink-0">
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
    <button
      id={props.id}
      type="button"
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'relative flex w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
        props.channel.channelType === 'direct_message'
          ? 'min-h-10 py-2'
          : 'h-8',
        props.selected && 'bg-active text-ink',
        !props.selected && props.focused && 'bg-hover text-ink',
        !props.selected &&
          !props.focused &&
          'text-ink-muted hover:bg-hover hover:text-ink'
      )}
      aria-current={props.selected ? 'page' : undefined}
      onClick={props.onActivate}
    >
      <ChannelAvatar channel={props.channel} />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {props.channel.name}
      </span>
      <Show when={props.unread}>
        <span
          aria-label="Unread"
          class="size-2 shrink-0 rounded-full bg-accent"
        />
      </Show>
    </button>
  );
}

function SlimChannelOption(props: ChannelOptionProps) {
  return (
    <Tooltip label={props.channel.name} placement="right" class="size-10">
      <button
        id={props.id}
        type="button"
        role="treeitem"
        tabIndex={-1}
        class={cn(
          'relative flex size-10 min-h-10 items-center justify-center rounded-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
          props.selected && 'bg-active text-ink',
          !props.selected && props.focused && 'bg-hover text-ink',
          !props.selected &&
            !props.focused &&
            'text-ink-muted hover:bg-hover hover:text-ink'
        )}
        aria-current={props.selected ? 'page' : undefined}
        onClick={props.onActivate}
      >
        <SlimChannelAvatar channel={props.channel} />
        <Show when={props.unread}>
          <span
            aria-label="Unread"
            class="absolute right-1.5 top-1 size-2 rounded-full bg-accent"
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
    <button
      id={props.id}
      type="button"
      role="treeitem"
      tabIndex={-1}
      class={cn(
        'w-full min-w-0 overflow-hidden px-2 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        props.selected && 'bg-active',
        !props.selected && props.focused && 'bg-hover',
        !props.selected && !props.focused && 'bg-transparent hover:bg-hover'
      )}
      aria-current={props.selected ? 'page' : undefined}
      onClick={props.onActivate}
    >
      <div class="flex min-w-0 items-start gap-3 overflow-hidden">
        <ChannelAvatar channel={props.channel} size="md" />
        <div class="min-w-0 flex-1 overflow-hidden">
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
  );
}

function SlimConversationCard(props: ConversationCardProps) {
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
          'flex size-10 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          props.selected && 'bg-active',
          !props.selected && props.focused && 'bg-hover',
          !props.selected && !props.focused && 'bg-transparent hover:bg-hover'
        )}
        aria-current={props.selected ? 'page' : undefined}
        onClick={props.onActivate}
      >
        <span class="relative">
          <SlimChannelAvatar channel={props.channel} />
          <Show when={props.unread}>
            <span
              aria-label="Unread"
              class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-surface"
            />
          </Show>
        </span>
      </button>
    </Tooltip>
  );
}

function SectionScrollArea(props: {
  contentRef: (element: HTMLDivElement) => void;
  containerClass?: string;
  class?: string;
  children: JSX.Element;
}) {
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();

  return (
    <div class={cn('relative min-h-0 flex-1', props.containerClass)}>
      <Scroll
        scrollRef={(element) => {
          setScrollRoot(element);
          props.contentRef(element);
        }}
      >
        <div role="group" class={props.class}>
          {props.children}
        </div>
      </Scroll>
      <ScrollIndicators
        scrollRef={scrollRoot}
        appearance="gradient"
        gradientColor="inset"
      />
    </div>
  );
}

function CollapsibleSectionRoot(props: {
  open: boolean;
  constrained: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <section
      class={cn(
        'flex min-h-0 flex-col gap-1',
        props.open && 'shrink',
        !props.open && 'shrink-0',
        props.open && props.constrained && 'max-h-[calc(50%_-_0.375rem)]',
        props.open && !props.constrained && 'max-h-full',
        props.class
      )}
    >
      {props.children}
    </section>
  );
}

function CollapsibleSectionHeader(props: {
  focused: boolean;
  focusWithin: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'flex w-full items-center rounded-xl text-xs font-semibold uppercase tracking-wide text-ink-extra-muted transition-colors hover:bg-hover hover:text-ink-muted',
        props.focused && 'bg-hover text-ink-muted',
        !props.focused && props.focusWithin && 'text-ink-muted',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function CollapsibleSectionContent(props: {
  open: boolean;
  contentRef: (element: HTMLDivElement) => void;
  containerClass?: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <Show when={props.open}>
      <SectionScrollArea
        contentRef={props.contentRef}
        containerClass={props.containerClass}
        class={props.class}
      >
        {props.children}
      </SectionScrollArea>
    </Show>
  );
}

const CollapsibleSection = {
  Root: CollapsibleSectionRoot,
  Header: CollapsibleSectionHeader,
  Content: CollapsibleSectionContent,
};

function CreateRailAction(props: {
  label: string;
  slim?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={cn(
        'flex shrink-0 items-center justify-center text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent',
        props.slim
          ? 'size-10 rounded-full border border-edge-muted bg-transparent'
          : 'size-7 rounded-lg'
      )}
      aria-label={props.label}
      onClick={props.onClick}
    >
      <PlusIcon class="size-3.5" />
    </button>
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
  const currentUserId = useUserId();
  const notificationSource = useGlobalNotificationSource();
  const listDomId = createUniqueId();
  const sectionScrollRoots: Partial<Record<ChannelsGroup, HTMLDivElement>> = {};

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

    rows.push(sectionRow('direct_messages'));
    if (state.expandedGroups.direct_messages) {
      rows.push(
        ...directMessages().map((channel) =>
          conversationRow(channel, 'direct_messages')
        )
      );
    }

    return rows;
  });

  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<ChannelRailRow>({
      items: visibleRows,
      getKey: (row) => row.id,
      isSelectable: () => false,
      initialFocusKey:
        state.selectedChannelId === undefined
          ? undefined
          : rowKeyForChannel(state.selectedChannelId),
      onActivate: ({ item }) => {
        if (item.kind === 'section') {
          setGroupOpen(item.group, !state.expandedGroups[item.group]);
          return;
        }

        setSelectedChannelId(item.channel.id);
      },
    })
  );

  const domIdForRow = (rowId: string) => `${listDomId}-${rowId}`;
  let listRoot: HTMLDivElement | undefined;
  const setSectionScrollRoot =
    (group: ChannelsGroup) => (element: HTMLDivElement) => {
      sectionScrollRoots[group] = element;
    };
  const scrollHandle: ListScrollHandle = {
    scrollToIndex: (index) => {
      const row = list.items.at(index);
      if (!row) return;

      const element = document.getElementById(domIdForRow(row.id));
      const scrollRoot =
        row.kind === 'conversation' && row.group
          ? sectionScrollRoots[row.group]
          : state.tab === 'recents'
            ? listRoot
            : undefined;
      if (!element || !scrollRoot) return;

      const elementBounds = element.getBoundingClientRect();
      const scrollBounds = scrollRoot.getBoundingClientRect();
      if (elementBounds.top < scrollBounds.top) {
        scrollRoot.scrollTop -= scrollBounds.top - elementBounds.top;
      } else if (elementBounds.bottom > scrollBounds.bottom) {
        scrollRoot.scrollTop += elementBounds.bottom - scrollBounds.bottom;
      }
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

  const jumpToSection = (offset: 1 | -1) => {
    const currentGroup = list.focus.item()?.group;
    const currentIndex = currentGroup
      ? CHANNEL_GROUPS.indexOf(currentGroup)
      : -1;
    const origin = currentIndex === -1 ? (offset === 1 ? -1 : 0) : currentIndex;

    const nextIndex =
      (origin + offset + CHANNEL_GROUPS.length) % CHANNEL_GROUPS.length;
    const nextGroup = CHANNEL_GROUPS[nextIndex];
    if (!nextGroup) return false;

    const result = list.focus.set(rowKeyForSection(nextGroup), {
      reason: 'keyboard',
    });
    if (!result) return false;

    listRoot?.focus({ preventScroll: true });
    scrollHandle.scrollToIndex(result.index);
    return true;
  };

  withSplitPanelOwner(listOwnedSlotName('section-hotkeys'), () => {
    const group = createHotkeyGroup();
    const enabled = () => panel.isPanelActive() && state.tab === 'browse';

    registerHotkey({
      hotkey: ']',
      scopeId: panel.splitHotkeyScope,
      description: 'Next channel section',
      condition: enabled,
      keyDownHandler: () => jumpToSection(1),
    }).withGroup(group);

    registerHotkey({
      hotkey: '[',
      scopeId: panel.splitHotkeyScope,
      description: 'Previous channel section',
      condition: enabled,
      keyDownHandler: () => jumpToSection(-1),
    }).withGroup(group);

    onCleanup(() => group.dispose());
    return group;
  });

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

  createEffect(
    on(
      () => props.mode,
      () => {
        const focusedIndex = list.focus.index();
        if (focusedIndex < 0) return;

        const frame = requestAnimationFrame(() => {
          scrollHandle.scrollToIndex(focusedIndex);
        });

        onCleanup(() => cancelAnimationFrame(frame));
      },
      { defer: true }
    )
  );

  const FullRail = () => (
    <>
      <div class="flex min-h-8 shrink-0 items-center px-4">
        <SplitPanel.ControlGroup>
          <SplitPanel.CloseButton />
          <SplitPanel.BackButton />
          <SplitPanel.ForwardButton />
        </SplitPanel.ControlGroup>
      </div>
      <div class="flex shrink-0 items-center px-4 pt-3">
        <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
          Chat
        </h1>
      </div>

      <div class="shrink-0 px-4 pt-3">
        <TabsInset
          aria-label="Chat sidebar views"
          class="h-9"
          trackClass="h-full"
          itemClass="h-full"
          labelClass="h-full py-0"
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
        class={cn(
          'scrollbar-hidden min-h-0 flex-1 pt-3 outline-none',
          state.tab === 'browse' ? 'overflow-hidden' : 'overflow-y-auto'
        )}
      >
        <Switch>
          <Match when={state.tab === 'browse'}>
            <div class="flex h-full min-h-0 flex-col gap-3 px-4">
              <CollapsibleSection.Root
                open={state.expandedGroups.channels}
                constrained={
                  state.expandedGroups.channels &&
                  state.expandedGroups.direct_messages
                }
              >
                <CollapsibleSection.Header
                  focused={list.focus.key() === rowKeyForSection('channels')}
                  focusWithin={list.focus.item()?.group === 'channels'}
                  class="h-9 has-[[data-section-action]:hover]:bg-transparent has-[[data-section-action]:focus-within]:bg-transparent"
                >
                  <button
                    id={domIdForRow(rowKeyForSection('channels'))}
                    type="button"
                    role="treeitem"
                    tabIndex={-1}
                    class="relative flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-expanded={state.expandedGroups.channels}
                    onClick={() => activateRow(rowKeyForSection('channels'))}
                  >
                    <CaretDownIcon
                      class={cn(
                        'size-3 shrink-0 transition-transform',
                        !state.expandedGroups.channels && '-rotate-90'
                      )}
                    />
                    <span class="min-w-0 flex-1 truncate">Channels</span>
                    <Show when={unreadTeamChannelCount() > 0}>
                      <span class="text-xxs tabular-nums">
                        {unreadTeamChannelCount()}
                      </span>
                    </Show>
                  </button>
                  <div data-section-action="" class="pr-1">
                    <CreateRailAction
                      label="Create channel"
                      onClick={() => openNewChannelModal()}
                    />
                  </div>
                </CollapsibleSection.Header>
                <CollapsibleSection.Content
                  open={state.expandedGroups.channels}
                  contentRef={setSectionScrollRoot('channels')}
                  class="flex min-h-0 flex-col gap-0.5"
                >
                  <Show
                    when={teamChannels().length > 0}
                    fallback={
                      <div class="px-2 py-2 text-xs text-ink-extra-muted">
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
                </CollapsibleSection.Content>
              </CollapsibleSection.Root>

              <CollapsibleSection.Root
                open={state.expandedGroups.direct_messages}
                constrained={
                  state.expandedGroups.channels &&
                  state.expandedGroups.direct_messages
                }
              >
                <CollapsibleSection.Header
                  focused={
                    list.focus.key() === rowKeyForSection('direct_messages')
                  }
                  focusWithin={list.focus.item()?.group === 'direct_messages'}
                  class="h-9 has-[[data-section-action]:hover]:bg-transparent has-[[data-section-action]:focus-within]:bg-transparent"
                >
                  <button
                    id={domIdForRow(rowKeyForSection('direct_messages'))}
                    type="button"
                    role="treeitem"
                    tabIndex={-1}
                    class="relative flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-expanded={state.expandedGroups.direct_messages}
                    onClick={() =>
                      activateRow(rowKeyForSection('direct_messages'))
                    }
                  >
                    <CaretDownIcon
                      class={cn(
                        'size-3 shrink-0 transition-transform',
                        !state.expandedGroups.direct_messages && '-rotate-90'
                      )}
                    />
                    <span class="min-w-0 flex-1 truncate">DMs</span>
                    <Show when={unreadDirectMessageCount() > 0}>
                      <span class="text-xxs tabular-nums">
                        {unreadDirectMessageCount()}
                      </span>
                    </Show>
                  </button>
                  <div data-section-action="" class="pr-1">
                    <CreateRailAction
                      label="Start direct message"
                      onClick={() => {
                        CommandState.clearQuery();
                        CommandState.setCategoryFilter('dms');
                        CommandState.open();
                      }}
                    />
                  </div>
                </CollapsibleSection.Header>
                <CollapsibleSection.Content
                  open={state.expandedGroups.direct_messages}
                  contentRef={setSectionScrollRoot('direct_messages')}
                  class="flex min-h-0 flex-col gap-0.5"
                >
                  <Show
                    when={directMessages().length > 0}
                    fallback={
                      <div class="px-2 py-2 text-xs text-ink-extra-muted">
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
                </CollapsibleSection.Content>
              </CollapsibleSection.Root>
            </div>
          </Match>
          <Match when={state.tab === 'recents'}>
            <Show
              when={recentConversations().length > 0}
              fallback={
                <div class="px-3 py-8 text-center text-sm text-ink-extra-muted">
                  No recent messages
                </div>
              }
            >
              <div class="flex w-full flex-col divide-y divide-edge-muted">
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
                      onActivate={() =>
                        activateRow(rowKeyForChannel(channel().id))
                      }
                    />
                  )}
                </Key>
              </div>
            </Show>
          </Match>
        </Switch>
      </div>
    </>
  );

  const SlimRail = () => (
    <>
      <div class="shrink-0 px-3">
        <TabsInset
          aria-label="Chat sidebar views"
          class="h-[76px]"
          trackClass="h-full flex-col"
          itemClass="h-auto min-h-0 w-full"
          labelClass="size-full p-0"
          fullWidth
          list={SLIM_CHANNEL_TABS}
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
        class={cn(
          'scrollbar-hidden min-h-0 flex-1 pt-3 outline-none',
          state.tab === 'browse' ? 'overflow-hidden' : 'overflow-y-auto'
        )}
      >
        <Switch>
          <Match when={state.tab === 'browse'}>
            <div class="flex h-full min-h-0 flex-col gap-3 px-2">
              <CollapsibleSection.Root
                open={state.expandedGroups.channels}
                constrained={
                  state.expandedGroups.channels &&
                  state.expandedGroups.direct_messages
                }
                class="items-center"
              >
                <CollapsibleSection.Header
                  focused={list.focus.key() === rowKeyForSection('channels')}
                  focusWithin={list.focus.item()?.group === 'channels'}
                  class="h-10 justify-center"
                >
                  <button
                    id={domIdForRow(rowKeyForSection('channels'))}
                    type="button"
                    role="treeitem"
                    tabIndex={-1}
                    class="relative flex size-10 min-w-10 flex-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-expanded={state.expandedGroups.channels}
                    aria-label="Channels"
                    onClick={() => activateRow(rowKeyForSection('channels'))}
                  >
                    <span class="flex items-center justify-center [&_svg]:size-4">
                      <ChannelIcon />
                    </span>
                    <Show when={unreadTeamChannelCount() > 0}>
                      <span class="text-xxs absolute right-0.5 top-0 tabular-nums">
                        {unreadTeamChannelCount()}
                      </span>
                    </Show>
                  </button>
                </CollapsibleSection.Header>
                <div class="w-full px-2">
                  <div class="border-t border-edge-muted" />
                </div>
                <CollapsibleSection.Content
                  open={state.expandedGroups.channels}
                  contentRef={setSectionScrollRoot('channels')}
                  containerClass="w-full"
                  class="flex min-h-0 w-full flex-col items-center gap-0.5"
                >
                  <div class="flex justify-center">
                    <CreateRailAction
                      label="Create channel"
                      slim
                      onClick={() => openNewChannelModal()}
                    />
                  </div>
                  <Show when={teamChannels().length > 0}>
                    <Key each={teamChannels()} by={(channel) => channel.id}>
                      {(channel) => (
                        <SlimChannelOption
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
                </CollapsibleSection.Content>
              </CollapsibleSection.Root>

              <CollapsibleSection.Root
                open={state.expandedGroups.direct_messages}
                constrained={
                  state.expandedGroups.channels &&
                  state.expandedGroups.direct_messages
                }
                class="items-center"
              >
                <CollapsibleSection.Header
                  focused={
                    list.focus.key() === rowKeyForSection('direct_messages')
                  }
                  focusWithin={list.focus.item()?.group === 'direct_messages'}
                  class="h-10 justify-center"
                >
                  <button
                    id={domIdForRow(rowKeyForSection('direct_messages'))}
                    type="button"
                    role="treeitem"
                    tabIndex={-1}
                    class="relative flex size-10 min-w-10 flex-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-expanded={state.expandedGroups.direct_messages}
                    aria-label="DMs"
                    onClick={() =>
                      activateRow(rowKeyForSection('direct_messages'))
                    }
                  >
                    <span class="flex items-center justify-center [&_svg]:size-4">
                      <ChatTeardropIcon />
                    </span>
                    <Show when={unreadDirectMessageCount() > 0}>
                      <span class="text-xxs absolute right-0.5 top-0 tabular-nums">
                        {unreadDirectMessageCount()}
                      </span>
                    </Show>
                  </button>
                </CollapsibleSection.Header>
                <div class="w-full px-2">
                  <div class="border-t border-edge-muted" />
                </div>
                <CollapsibleSection.Content
                  open={state.expandedGroups.direct_messages}
                  contentRef={setSectionScrollRoot('direct_messages')}
                  containerClass="w-full"
                  class="flex min-h-0 w-full flex-col items-center gap-0.5"
                >
                  <div class="flex justify-center">
                    <CreateRailAction
                      label="Start direct message"
                      slim
                      onClick={() => {
                        CommandState.clearQuery();
                        CommandState.setCategoryFilter('dms');
                        CommandState.open();
                      }}
                    />
                  </div>
                  <Show when={directMessages().length > 0}>
                    <Key each={directMessages()} by={(channel) => channel.id}>
                      {(channel) => (
                        <SlimChannelOption
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
                </CollapsibleSection.Content>
              </CollapsibleSection.Root>
            </div>
          </Match>
          <Match when={state.tab === 'recents'}>
            <Show when={recentConversations().length > 0}>
              <div class="flex w-full flex-col gap-0.5">
                <Key each={recentConversations()} by={(channel) => channel.id}>
                  {(channel) => (
                    <SlimConversationCard
                      id={domIdForRow(rowKeyForChannel(channel().id))}
                      channel={channel()}
                      senderId={channel().latestRootMessage?.senderId}
                      mentionedCurrentUser={mentionsCurrentUser(channel())}
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
              </div>
            </Show>
          </Match>
        </Switch>
      </div>
    </>
  );

  return (
    <aside
      aria-label="Chat navigation"
      class="flex size-full min-h-0 flex-col bg-inset pb-5 pt-2"
    >
      <Switch>
        <Match when={props.mode === 'full'}>
          <FullRail />
        </Match>
        <Match when={props.mode === 'slim'}>
          <SlimRail />
        </Match>
      </Switch>
    </aside>
  );
}
