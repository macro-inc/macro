import { CommandState } from '@app/features/command';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { ComposedSplitHeader } from '@components/app/split-layout/composed/ComposedSplitHeader';
import {
  clampMessagesSidebarWidth,
  effectiveMessagesSidebarWidth,
  MAX_MESSAGES_SIDEBAR_WIDTH,
  messagesSidebarWidth,
  MIN_MESSAGES_SIDEBAR_WIDTH,
  setEffectiveMessagesSidebarWidth,
  setMessagesSidebarWidth,
} from '@components/app/split-layout/messagesSidebarWidth';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUserId } from '@core/context/user';
import { compareDateDesc } from '@core/util/date';
import { Entity, type ChannelEntity, isChannelEntity } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import ChannelIcon from '@icon/wide-channel.svg';
import ReplyIcon from '@phosphor/arrow-bend-up-left.svg';
import AtIcon from '@phosphor/at.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import ChatTeardropIcon from '@phosphor/chat-teardrop.svg';
import PlusIcon from '@phosphor/plus.svg';
import { useUserNamesQuery } from '@queries/auth/user-names';
import { createElementSize } from '@solid-primitives/resize-observer';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { cn, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';

const SIDEBAR_CHANNEL_LIMIT = 100;
const NARROW_MESSAGES_SIDEBAR_WIDTH = 64;
type MessagesSidebarTab = 'conversations' | 'messages';

type ExperimentalMessagesRailProps = {
  selectedChannelId?: string;
  onSelect: (channel: ChannelEntity) => void;
};

function channelInitials(name: string) {
  const words = name
    .replace(/^#+/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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
      ? 'size-9 [&_svg]:size-4.5 @max-[720px]/experimental-soup:size-6 @max-[720px]/experimental-soup:[&_svg]:size-3.5'
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
          <span class="flex size-full items-center justify-center @max-[720px]/experimental-soup:hidden">
            <Entity.Icon
              entity={props.channel}
              suppressClick
              showTooltip={false}
            />
          </span>
          <span class="hidden size-full items-center justify-center rounded-full border border-edge bg-lift text-[9px] font-semibold tracking-wide text-ink @max-[720px]/experimental-soup:flex">
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
        <Entity.Icon
          entity={props.channel}
          suppressClick
          showTooltip={false}
        />
      </span>
    </Show>
  );
}

function ChannelOption(props: {
  channel: ChannelEntity;
  unread: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip
      label={props.channel.name}
      placement="right"
      class="w-full"
    >
      <button
        type="button"
        class={cn(
          'relative flex w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 @max-[720px]/experimental-soup:mx-auto @max-[720px]/experimental-soup:size-10 @max-[720px]/experimental-soup:min-h-10 @max-[720px]/experimental-soup:justify-center @max-[720px]/experimental-soup:rounded-full @max-[720px]/experimental-soup:px-0 @max-[720px]/experimental-soup:py-0',
        props.channel.channelType === 'direct_message'
          ? 'min-h-10 py-2'
          : 'h-8',
        props.selected
          ? 'bg-active text-ink'
          : 'text-ink-muted hover:bg-hover hover:text-ink'
      )}
      aria-current={props.selected ? 'page' : undefined}
      onClick={props.onSelect}
    >
      <ChannelAvatar channel={props.channel} />
      <span class="min-w-0 flex-1 truncate text-[13px] font-medium @max-[720px]/experimental-soup:hidden">
        {props.channel.name}
      </span>
      <Show when={props.unread}>
        <span
          aria-label="Unread"
          class="size-2 shrink-0 rounded-full bg-accent @max-[720px]/experimental-soup:absolute @max-[720px]/experimental-soup:right-1.5 @max-[720px]/experimental-soup:top-1"
        />
        </Show>
      </button>
    </Tooltip>
  );
}

function ConversationCard(props: {
  channel: ChannelEntity;
  senderName: string;
  mentionedCurrentUser: boolean;
  unread: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const latestRootMessage = () => props.channel.latestRootMessage;

  return (
    <Tooltip
      label={props.channel.name}
      placement="right"
      class="w-full"
    >
      <button
        type="button"
        class={cn(
          'w-full min-w-0 px-2 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 @max-[720px]/experimental-soup:mx-auto @max-[720px]/experimental-soup:flex @max-[720px]/experimental-soup:size-10 @max-[720px]/experimental-soup:items-center @max-[720px]/experimental-soup:justify-center @max-[720px]/experimental-soup:rounded-full @max-[720px]/experimental-soup:px-0 @max-[720px]/experimental-soup:py-0',
        props.selected ? 'bg-active' : 'bg-transparent hover:bg-hover'
      )}
      aria-current={props.selected ? 'page' : undefined}
      onClick={props.onSelect}
    >
      <div class="flex min-w-0 items-start gap-3 @max-[720px]/experimental-soup:justify-center">
        <div class="relative shrink-0">
          <ChannelAvatar channel={props.channel} size="md" />
          <Show when={props.unread}>
            <span
              aria-label="Unread"
              class="absolute -right-0.5 -top-0.5 hidden size-2 rounded-full bg-accent ring-2 ring-surface @max-[720px]/experimental-soup:block"
            />
          </Show>
        </div>
        <div class="min-w-0 flex-1 @max-[720px]/experimental-soup:hidden">
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
                <span class="shrink-0 text-[11px] text-ink-extra-muted">
                  <Entity.Timestamp
                    entity={props.channel}
                    overrideTimeStamp={createdAt()}
                  />
                </span>
              )}
            </Show>
          </span>
          <span class="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-ink-extra-muted">
            <span class="min-w-0 truncate font-medium text-ink-muted">
              {props.senderName}
            </span>
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
          <Show
            when={latestRootMessage()?.content.trim()}
            fallback={
              <span class="block text-xs leading-4 text-ink-extra-muted">
                No messages yet
              </span>
            }
          >
            {(content) => (
              <div class="-mt-px text-xs leading-4 text-ink-muted [&_*]:my-0">
                <StaticMarkdown markdown={content()} />
              </div>
            )}
          </Show>
          </div>
        </div>
      </button>
    </Tooltip>
  );
}

function CollapsibleSection(props: {
  title: string;
  narrowIcon: JSX.Element;
  open: boolean;
  unreadCount?: number;
  onToggle: () => void;
  action?: () => JSX.Element;
  children: JSX.Element;
}) {
  const [actionHovered, setActionHovered] = createSignal(false);

  return (
    <section>
      <div
        role="button"
        tabIndex={0}
        class={cn(
          'group/section-header relative flex h-9 w-full items-center gap-2 rounded-xl px-2 text-xs font-semibold uppercase tracking-wide text-ink-extra-muted outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 @max-[720px]/experimental-soup:mx-auto @max-[720px]/experimental-soup:size-10 @max-[720px]/experimental-soup:justify-center @max-[720px]/experimental-soup:rounded-full @max-[720px]/experimental-soup:px-0 @max-[720px]/experimental-soup:text-ink-extra-muted/50',
          actionHovered()
            ? 'bg-transparent'
            : 'hover:bg-hover hover:text-ink-muted'
        )}
        aria-expanded={props.open}
        onClick={props.onToggle}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          props.onToggle();
        }}
      >
        <span class="hidden size-4 shrink-0 items-center justify-center @max-[720px]/experimental-soup:flex [&_svg]:size-4">
          {props.narrowIcon}
        </span>
        <span class="min-w-0 flex-1 truncate @max-[720px]/experimental-soup:hidden">
          {props.title}
        </span>
        <Show when={!props.open && (props.unreadCount ?? 0) > 0}>
          <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-panel @max-[720px]/experimental-soup:absolute @max-[720px]/experimental-soup:-right-0.5 @max-[720px]/experimental-soup:-top-0.5 @max-[720px]/experimental-soup:h-3.5 @max-[720px]/experimental-soup:min-w-3.5 @max-[720px]/experimental-soup:px-0.5 @max-[720px]/experimental-soup:text-[8px]">
            {Math.min(props.unreadCount ?? 0, 99)}
          </span>
        </Show>
        <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/section-header:opacity-100 group-focus-within/section-header:opacity-100 @max-[720px]/experimental-soup:hidden">
          <div
            onClick={(event) => event.stopPropagation()}
            onMouseEnter={() => setActionHovered(true)}
            onMouseLeave={() => setActionHovered(false)}
            onFocusIn={() => setActionHovered(true)}
            onFocusOut={() => setActionHovered(false)}
          >
            {props.action?.()}
          </div>
          <CaretDownIcon
            class={cn(
              'size-3.5 shrink-0 transition-transform',
              !props.open && '-rotate-90'
            )}
          />
        </div>
      </div>
      <div class="mx-2 hidden border-t border-ink/[0.05] @max-[720px]/experimental-soup:block" />
      <Show when={props.open}>
        <div class="mt-1 flex flex-col gap-0.5">
          <Show when={props.action}>
            <div class="mb-0.5 hidden justify-center @max-[720px]/experimental-soup:flex [&_button]:size-8! [&_button]:rounded-full! [&_button]:border [&_button]:border-edge-muted [&_button]:bg-transparent!">
              {props.action?.()}
            </div>
          </Show>
          {props.children}
        </div>
      </Show>
    </section>
  );
}

/** V5 Chat sidebar with categorized destinations and recent message cards. */
export function ExperimentalMessagesRail(props: ExperimentalMessagesRailProps) {
  const currentUserId = useUserId();
  const notificationSource = useGlobalNotificationSource();
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
  const [resizing, setResizing] = createSignal(false);
  let sidebarRef: HTMLElement | undefined;
  let stopResize: (() => void) | undefined;
  const parentSize = createElementSize(() => sidebarRef?.parentElement);
  const narrowSidebar = () =>
    parentSize.width !== null && parentSize.width <= 720;

  createEffect(() => {
    setEffectiveMessagesSidebarWidth(
      narrowSidebar()
        ? Math.min(messagesSidebarWidth(), NARROW_MESSAGES_SIDEBAR_WIDTH)
        : messagesSidebarWidth()
    );
  });

  const startResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();

    stopResize?.();
    setResizing(true);
    const startX = event.clientX;
    const startWidth = messagesSidebarWidth();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      setMessagesSidebarWidth(
        clampMessagesSidebarWidth(
          startWidth + moveEvent.clientX - startX
        )
      );
    };

    const finishResize = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setResizing(false);
      if (stopResize === finishResize) stopResize = undefined;
    };

    stopResize = finishResize;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
  };

  const resizeWithKeyboard = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setMessagesSidebarWidth((width) =>
        clampMessagesSidebarWidth(width - step)
      );
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setMessagesSidebarWidth((width) =>
        clampMessagesSidebarWidth(width + step)
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      setMessagesSidebarWidth(MIN_MESSAGES_SIDEBAR_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      setMessagesSidebarWidth(MAX_MESSAGES_SIDEBAR_WIDTH);
    }
  };

  onCleanup(() => stopResize?.());

  const [activeTab, setActiveTab] =
    createSignal<MessagesSidebarTab>('conversations');
  const [channelsOpen, setChannelsOpen] = createSignal(true);
  const [directMessagesOpen, setDirectMessagesOpen] = createSignal(true);
  const channelsQuery = useSoupAstItemsQuery(
    () => ({
      params: {
        limit: SIDEBAR_CHANNEL_LIMIT,
        sort_method: 'updated_at',
      },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({
            include: {
              channelImportance: true,
              channelIsParticipant: [true],
            },
          })
        )
      ),
    }),
    () => ({ staleTime: 30_000 })
  );

  const channels = createMemo(() =>
    (channelsQuery.data?.entities ?? []).filter(isChannelEntity)
  );
  const teamChannels = createMemo(() =>
    channels().filter((channel) => channel.channelType !== 'direct_message')
  );
  const directMessages = createMemo(() =>
    channels().filter((channel) => channel.channelType === 'direct_message')
  );
  const unreadTeamChannelCount = createMemo(
    () =>
      teamChannels().filter((channel) =>
        unreadChannelIds().has(channel.id)
      ).length
  );
  const unreadDirectMessageCount = createMemo(
    () =>
      directMessages().filter((channel) =>
        unreadChannelIds().has(channel.id)
      ).length
  );
  const recentConversations = createMemo(() =>
    channels()
      .filter((channel) => channel.latestRootMessage)
      .sort((a, b) =>
        compareDateDesc(
          a.latestRootMessage?.createdAt,
          b.latestRootMessage?.createdAt
        )
      )
  );
  const senderNameQueries = useUserNamesQuery({
    userIds: () =>
      recentConversations().flatMap((channel) =>
        channel.latestRootMessage?.senderId
          ? [channel.latestRootMessage.senderId]
          : []
      ),
    enabled: () => activeTab() === 'messages',
  });
  const senderNames = createMemo(() => {
    const names = new Map<string, string>();
    for (const query of senderNameQueries) {
      const user = query.data;
      if (!user) continue;
      const displayName = [user.first_name, user.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (displayName) names.set(user.id.toLocaleLowerCase(), displayName);
    }
    return names;
  });
  const senderName = (channel: ChannelEntity) => {
    const senderId = channel.latestRootMessage?.senderId;
    if (!senderId) return 'Unknown sender';
    if (senderId.toLocaleLowerCase() === currentUserId()?.toLocaleLowerCase()) {
      return 'You';
    }
    if (senderId.startsWith('bot|')) return 'Bot';
    return senderNames().get(senderId.toLocaleLowerCase()) ?? 'Someone';
  };
  const mentionsCurrentUser = (channel: ChannelEntity) => {
    const userId = currentUserId()?.toLocaleLowerCase();
    return Boolean(
      userId &&
        channel.latestRootMessage?.mentions.some(
          (mention) => mention.toLocaleLowerCase() === userId
        )
    );
  };

  return (
    <aside
      ref={sidebarRef}
      aria-label="Chat navigation"
      class="relative flex h-full shrink-0 flex-col pb-5 pt-4"
      style={{ width: `${effectiveMessagesSidebarWidth()}px` }}
    >
      <ComposedSplitHeader class="mx-4 flex min-h-10 shrink-0 items-center @max-[720px]/experimental-soup:hidden">
        <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
          Chat
        </h1>
      </ComposedSplitHeader>

      <div
        class="mx-4 mt-5 grid h-9 shrink-0 grid-cols-2 gap-1 rounded-xl bg-ink/4 p-1 @max-[720px]/experimental-soup:mx-2 @max-[720px]/experimental-soup:mt-0 @max-[720px]/experimental-soup:h-[76px] @max-[720px]/experimental-soup:grid-cols-1"
        role="tablist"
        aria-label="Chat sidebar views"
      >
        <For
          each={
            [
              { id: 'conversations', label: 'Browse' },
              { id: 'messages', label: 'Recents' },
            ] as const
          }
        >
          {(tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab() === tab.id}
              class={cn(
                'flex min-w-0 items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors @max-[720px]/experimental-soup:mx-auto @max-[720px]/experimental-soup:aspect-square @max-[720px]/experimental-soup:w-8 @max-[720px]/experimental-soup:px-0',
                activeTab() === tab.id
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-ink-muted hover:text-ink'
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              <span class="@max-[720px]/experimental-soup:hidden">
                {tab.label}
              </span>
              <span class="hidden items-center justify-center @max-[720px]/experimental-soup:flex [&_svg]:size-4">
                <Show
                  when={tab.id === 'conversations'}
                  fallback={<ChatTextIcon />}
                >
                  <ChatsIcon />
                </Show>
              </span>
            </button>
          )}
        </For>
      </div>

      <div class="scrollbar-hidden mt-3 min-h-0 flex-1 overflow-y-auto">
        <Show
          when={activeTab() === 'conversations'}
          fallback={
            <Show
              when={recentConversations().length > 0}
              fallback={
                <div class="px-3 py-8 text-center text-sm text-ink-extra-muted">
                  No recent messages
                </div>
              }
            >
              <div class="flex w-full flex-col divide-y divide-ink/[0.05] @max-[720px]/experimental-soup:gap-0.5 @max-[720px]/experimental-soup:divide-y-0">
                <For each={recentConversations()}>
                  {(channel) => (
                    <ConversationCard
                      channel={channel}
                      senderName={senderName(channel)}
                      mentionedCurrentUser={mentionsCurrentUser(channel)}
                      unread={unreadChannelIds().has(channel.id)}
                      selected={props.selectedChannelId === channel.id}
                      onSelect={() => props.onSelect(channel)}
                    />
                  )}
                </For>
              </div>
            </Show>
          }
        >
          <div class="flex flex-col gap-3 px-4 @max-[720px]/experimental-soup:px-2">
            <CollapsibleSection
              title="Channels"
              narrowIcon={<ChannelIcon />}
              open={channelsOpen()}
              unreadCount={unreadTeamChannelCount()}
              onToggle={() => setChannelsOpen((open) => !open)}
              action={() => (
                <button
                  type="button"
                  class="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label="Create channel"
                  onClick={() => openNewChannelModal()}
                >
                  <PlusIcon class="size-3.5" />
                </button>
              )}
            >
              <Show
                when={teamChannels().length > 0}
                fallback={
                  <div class="px-2 py-2 text-xs text-ink-extra-muted">
                    No channels
                  </div>
                }
              >
                <For each={teamChannels()}>
                  {(channel) => (
                    <ChannelOption
                      channel={channel}
                      unread={unreadChannelIds().has(channel.id)}
                      selected={props.selectedChannelId === channel.id}
                      onSelect={() => props.onSelect(channel)}
                    />
                  )}
                </For>
              </Show>
            </CollapsibleSection>

            <CollapsibleSection
              title="DMs"
              narrowIcon={<ChatTeardropIcon />}
              open={directMessagesOpen()}
              unreadCount={unreadDirectMessageCount()}
              onToggle={() => setDirectMessagesOpen((open) => !open)}
              action={() => (
                <button
                  type="button"
                  class="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label="Start direct message"
                  onClick={() => {
                    CommandState.clearQuery();
                    CommandState.setCategoryFilter('dms');
                    CommandState.open();
                  }}
                >
                  <PlusIcon class="size-3.5" />
                </button>
              )}
            >
              <Show
                when={directMessages().length > 0}
                fallback={
                  <div class="px-2 py-2 text-xs text-ink-extra-muted">
                    No direct messages
                  </div>
                }
              >
                <For each={directMessages()}>
                  {(channel) => (
                    <ChannelOption
                      channel={channel}
                      unread={unreadChannelIds().has(channel.id)}
                      selected={props.selectedChannelId === channel.id}
                      onSelect={() => props.onSelect(channel)}
                    />
                  )}
                </For>
              </Show>
            </CollapsibleSection>
          </div>
        </Show>
      </div>

      <Show when={!narrowSidebar()}>
        <div
          role="separator"
          aria-label="Resize Chat navigation"
          aria-orientation="vertical"
          aria-valuemin={MIN_MESSAGES_SIDEBAR_WIDTH}
          aria-valuemax={MAX_MESSAGES_SIDEBAR_WIDTH}
          aria-valuenow={Math.round(messagesSidebarWidth())}
          tabIndex={0}
          class={cn(
            'absolute -right-1 inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none',
            'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-accent after:opacity-0 after:transition-opacity',
            'hover:after:opacity-100 focus-visible:after:opacity-100',
            resizing() && 'after:opacity-100'
          )}
          onPointerDown={startResize}
          onKeyDown={resizeWithKeyboard}
        />
      </Show>
    </aside>
  );
}
