import { makeMuteAction } from '@app/features/next-soup/actions';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToChannelMessage } from '@block-channel/utils/link';
import { ReadonlyThread } from '@channel/StandaloneThread';
import {
  CollapsibleSidebarSection,
  type CollapsibleSidebarSectionItem,
} from '@components/app/app-sidebar/collapsible-sidebar-section';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  ContextMenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { compareDateDesc } from '@core/util/date';
import { type ChannelEntity, EntityRowIcon, isChannelEntity } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { openNotification } from '@notifications';
import {
  isChannelNotification,
  notificationIsRead,
} from '@notifications/notification-helpers';
import { getChannelNotificationParams } from '@notifications/notification-navigation';
import type { UnifiedNotification } from '@notifications/types';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { Key } from '@solid-primitives/keyed';
import { makePersisted } from '@solid-primitives/storage';
import { cn, NavRow, Surface, ToggleSwitch, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';

/** Rows the channel list shows before it scrolls internally. */
const VISIBLE_CHANNEL_COUNT = 12;
/**
 * How long the user must be done scrolling the list before a new channel
 * message snaps it back to the top.
 */
const SCROLL_IDLE_SNAP_MS = 5000;
/** Icon rows shown in the slim rail (unread channels only). */
const SLIM_MAX = 4;
const RECENT_CHANNELS_LIMIT = 100;
const RECENT_CHANNELS_STALE_MS = 5 * 60 * 1000;

/** A channel from the recent-channels query plus its unread notifications. */
interface RecentChannel {
  entity: ChannelEntity;
  /** Unread channel notifications, newest first. */
  unread: UnifiedNotification[];
}

function unreadCountLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * Open a channel like the soup list would: an unread channel opens at its
 * newest unread message, a read one opens at the latest message.
 */
function useOpenChannel() {
  const layout = useSplitLayout();
  return (channel: RecentChannel, newSplit: boolean) => {
    const manager = globalSplitManager();
    if (!manager) return;
    const notification = channel.unread[0];
    if (notification) {
      openNotification(notification, manager, newSplit);
      return;
    }
    layout.openWithSplit(
      { type: 'channel', id: channel.entity.id },
      { preferNewSplit: newSplit, referredFrom: 'sidebar' }
    );
  };
}

const HOVER_PREVIEW_COUNT = 3;

// Unique thread roots (a reply previews its whole thread), newest first.
function getPreviewThreadRoots(notifications: UnifiedNotification[]): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const notification of notifications) {
    const { messageId, threadId } = getChannelNotificationParams(notification);
    const rootId = threadId ?? messageId;
    if (!rootId || seen.has(rootId)) continue;
    seen.add(rootId);
    roots.push(rootId);
  }
  return roots;
}

function ChannelHoverPreview(props: { channel: RecentChannel }) {
  const orchestrator = useGlobalBlockOrchestrator();
  const roots = () => getPreviewThreadRoots(props.channel.unread);
  // Show the latest few threads oldest → newest, like the channel reads.
  const visible = () => roots().slice(0, HOVER_PREVIEW_COUNT).reverse();
  const hiddenCount = () => roots().length - visible().length;

  return (
    <div class="w-90 min-h-12 max-h-96 overflow-y-auto overscroll-contain flex flex-col py-1">
      <Show when={hiddenCount() > 0}>
        <span class="px-3 py-1 text-xs text-ink-extra-muted">
          +{hiddenCount()} earlier
        </span>
      </Show>
      <For each={visible()}>
        {(rootMessageId) => (
          <ReadonlyThread
            channelId={props.channel.entity.id}
            messageId={rootMessageId}
            onClickMessage={(clickedMessageId, e) => {
              e.stopPropagation();
              const isReply = clickedMessageId !== rootMessageId;
              navigateToChannelMessage(
                orchestrator,
                props.channel.entity.id,
                clickedMessageId,
                isReply ? rootMessageId : undefined
              );
            }}
          />
        )}
      </For>
    </div>
  );
}

function UnreadHoverCard(
  props: ParentProps<{
    channel: RecentChannel;
    disabled?: boolean;
    onOpenChange?: (open: boolean) => void;
  }>
) {
  const [hovered, setHovered] = createSignal(false);
  const open = () => hovered() && !props.disabled;

  createEffect(() => props.onOpenChange?.(open()));

  return (
    <Show when={!isTouchDevice()} fallback={props.children}>
      <KobalteTooltip
        open={open()}
        onOpenChange={setHovered}
        placement="right"
        overflowPadding={16}
        fitViewport={true}
        closeDelay={250}
        openDelay={1000}
        flip={true}
        gutter={4}
      >
        <KobalteTooltip.Trigger
          class="inline-flex items-center w-full"
          as="div"
        >
          {props.children}
        </KobalteTooltip.Trigger>
        <KobalteTooltip.Portal>
          <KobalteTooltip.Content class="z-tool-tip max-w-[calc(100vw-32px)] menu-open-animation">
            <Surface
              depth={3}
              hideBorder
              class="shadow-menu ring ring-edge rounded-xl"
            >
              <ChannelHoverPreview channel={props.channel} />
            </Surface>
          </KobalteTooltip.Content>
        </KobalteTooltip.Portal>
      </KobalteTooltip>
    </Show>
  );
}

function ChannelRow(props: {
  channel: RecentChannel;
  isSlim?: boolean;
  onFloatingOpenChange?: (open: boolean) => void;
}) {
  const notificationSource = useGlobalNotificationSource();
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
  });
  const openChannel = useOpenChannel();

  const entity = () => props.channel.entity;
  const isUnread = () => props.channel.unread.length > 0;
  const unreadCount = () => props.channel.unread.length;
  const isSlim = () => props.isSlim ?? false;

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? false;

  const openInCurrentSplit = () => openChannel(props.channel, false);

  const openInNewSplit = () => {
    if (!canOpenInNewSplit()) return;
    openChannel(props.channel, true);
  };

  const markAllAsRead = () => {
    void notificationSource.bulkMarkAsRead(props.channel.unread);
  };

  const ButtonContent = () => (
    <NavRow
      class="justify-start w-full h-7"
      draggable={false}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        openChannel(props.channel, e.shiftKey);
      }}
    >
      <div class="relative flex items-center justify-center shrink-0 size-5">
        <div class="size-3.5">
          <EntityRowIcon entity={entity()} suppressClick showTooltip={false} />
        </div>
        <Show when={isSlim() && isUnread()}>
          <span class="absolute -top-1.5 -right-1.5 min-w-3.5 h-3.5 px-0.5 flex items-center justify-center text-[9px] leading-none font-medium bg-accent text-surface rounded-full ring-surface ring-2">
            {unreadCountLabel(unreadCount())}
          </span>
        </Show>
      </div>

      <Show when={!isSlim()}>
        <span class="text-sm font-medium truncate flex-1 text-start">
          {entity().name}
        </span>
      </Show>
      <Show when={!isSlim() && isUnread()}>
        <span class="ml-auto shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-ink/6 text-ink-muted rounded-md">
          {unreadCountLabel(unreadCount())}
        </span>
      </Show>
    </NavRow>
  );

  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [hoverCardOpen, setHoverCardOpen] = createSignal(false);

  createEffect(() => {
    props.onFloatingOpenChange?.(contextMenuOpen() || hoverCardOpen());
  });

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenu.Trigger
        class={cn(isSlim() ? 'flex justify-center' : 'w-full')}
      >
        <Show
          when={!isSlim()}
          fallback={
            <Tooltip label={entity().name} placement="right">
              <ButtonContent />
            </Tooltip>
          }
        >
          <UnreadHoverCard
            channel={props.channel}
            disabled={contextMenuOpen() || !isUnread()}
            onOpenChange={setHoverCardOpen}
          >
            <ButtonContent />
          </UnreadHoverCard>
        </Show>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenuContent class="text-xs text-ink-muted">
          <MenuGroup>
            <MenuItem
              text="Open in new split"
              onClick={openInNewSplit}
              disabled={!canOpenInNewSplit()}
            />
            <MenuItem
              text="Open in current split"
              onClick={openInCurrentSplit}
            />
          </MenuGroup>
          <Show when={isUnread()}>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem text="Mark as read" onClick={markAllAsRead} />
            </MenuGroup>
          </Show>
          <Show when={muteAction.canExecute(entity())}>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem
                text={
                  muteAction.isMuted(entity())
                    ? 'Unmute notifications'
                    : 'Mute notifications'
                }
                onClick={() => void muteAction.execute([entity()])}
              />
            </MenuGroup>
          </Show>
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

export const ChannelsRecentWidget = (props: {
  sidebarState: SidebarState;
  /** Rows visible before the list scrolls. */
  maxVisible?: number;
  onSectionOpenChange?: () => void;
  onDropdownOpenChange?: (open: boolean) => void;
  headerWrapper?: (header: JSX.Element) => JSX.Element;
}) => {
  const notificationSource = useGlobalNotificationSource();
  const [unreadOnly, setUnreadOnly] = makePersisted(createSignal(false), {
    name: 'sidebar-recent-channels-unread-only',
  });

  const channelsQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: RECENT_CHANNELS_LIMIT, sort_method: 'updated_at' },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({
            include: { channelImportance: true, channelIsParticipant: [true] },
          })
        )
      ),
    }),
    () => ({ staleTime: RECENT_CHANNELS_STALE_MS })
  );

  const unreadByChannel = createMemo(() => {
    const map = new Map<string, UnifiedNotification[]>();
    for (const notification of notificationSource.notifications()) {
      if (notification.entity_type !== 'channel') continue;
      if (notificationIsRead(notification)) continue;
      const list = map.get(notification.entity_id);
      if (list) list.push(notification);
      else map.set(notification.entity_id, [notification]);
    }
    // `unread[0]` must be the newest notification (it aims open-at-unread and
    // the hover previews); don't rely on the source list's ordering.
    for (const list of map.values()) {
      list.sort((a, b) => compareDateDesc(a.created_at, b.created_at));
    }
    return map;
  });

  // A channel can carry unread notifications while being older than the
  // newest-RECENT_CHANNELS_LIMIT window the main query returns. Fetch those
  // stragglers by id so an unread channel always makes the list.
  const missingUnreadChannelIds = createMemo(() => {
    const entities = channelsQuery.data?.entities;
    if (!entities) return [];
    const listed = new Set(
      entities.filter(isChannelEntity).map((entity) => entity.id)
    );
    // Sorted so the derived query key is stable across notification reorders.
    return [...unreadByChannel().keys()].filter((id) => !listed.has(id)).sort();
  });

  const missingUnreadChannelsQuery = useSoupAstItemsQuery(
    () => ({
      // Sized to the id list, not RECENT_CHANNELS_LIMIT: this query must
      // return every exact-id match, and a fixed limit would silently drop
      // the oldest ones past it. (The server's [20, 500] clamp covers only
      // the merged page; the channel SQL takes this limit verbatim, safe
      // here because the exact-id filter runs before LIMIT.)
      params: {
        limit: missingUnreadChannelIds().length,
        sort_method: 'updated_at',
      },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({
            include: {
              channelId: missingUnreadChannelIds(),
              channelImportance: true,
              channelIsParticipant: [true],
            },
          })
        )
      ),
    }),
    () => ({
      enabled: missingUnreadChannelIds().length > 0,
      staleTime: RECENT_CHANNELS_STALE_MS,
    })
  );

  const recentChannels = createMemo<RecentChannel[]>(() => {
    const unread = unreadByChannel();
    // Only ids still missing may merge in: placeholder rows from a previous id
    // set must not duplicate a listed channel or resurrect a since-read one.
    const missing = new Set(missingUnreadChannelIds());
    const channels = [
      ...(channelsQuery.data?.entities ?? []).filter(isChannelEntity),
      ...(missingUnreadChannelsQuery.data?.entities ?? [])
        .filter(isChannelEntity)
        .filter((entity) => missing.has(entity.id)),
    ].map((entity) => ({ entity, unread: unread.get(entity.id) ?? [] }));
    // Same ordering as the channels soup view…
    channels.sort((a, b) =>
      compareDateDesc(
        a.entity.sortTs ?? a.entity.updatedAt,
        b.entity.sortTs ?? b.entity.updatedAt
      )
    );
    // …but with unread channels sorted to the top.
    return [
      ...channels.filter((channel) => channel.unread.length > 0),
      ...channels.filter((channel) => channel.unread.length === 0),
    ];
  });
  const visibleChannels = createMemo(() =>
    unreadOnly()
      ? recentChannels().filter((channel) => channel.unread.length > 0)
      : recentChannels()
  );
  const showAllCaughtUp = () =>
    unreadOnly() &&
    recentChannels().length > 0 &&
    visibleChannels().length === 0;

  const maxVisible = () => props.maxVisible ?? VISIBLE_CHANNEL_COUNT;
  // The list shows `maxVisible` rows (h-7 rows, gap-0.5) and scrolls inside
  // itself to reveal the rest.
  const listMaxHeight = () =>
    `calc(${maxVisible()} * 1.75rem + ${Math.max(0, maxVisible() - 1)} * 0.125rem)`;

  // The slim rail keeps its "unread at a glance" role: unread channels only.
  const slimChannels = () =>
    recentChannels().filter((channel) => channel.unread.length > 0);
  const slimVisible = () => slimChannels().slice(0, SLIM_MAX);
  const slimOverflow = () => Math.max(0, slimChannels().length - SLIM_MAX);

  const isSlim = () => props.sidebarState === 'slim';

  let channelListRef: HTMLDivElement | undefined;
  let lastUserScrollAt = 0;
  let suppressNextScrollEvent = false;

  const [hasOverflowTop, setHasOverflowTop] = createSignal(false);
  const [hasOverflowBottom, setHasOverflowBottom] = createSignal(false);
  let listScrollFrame: number | undefined;

  const updateListScrollShadows = () => {
    const el = channelListRef;
    if (!el) return;
    const maxScrollTop = el.scrollHeight - el.clientHeight;
    setHasOverflowTop(el.scrollTop > 1);
    setHasOverflowBottom(maxScrollTop - el.scrollTop > 1);
  };

  const scheduleListScrollUpdate = () => {
    if (listScrollFrame !== undefined) cancelAnimationFrame(listScrollFrame);
    listScrollFrame = requestAnimationFrame(() => {
      listScrollFrame = undefined;
      updateListScrollShadows();
    });
  };

  // Overflow can change without a scroll event (channels load in, rows are
  // removed, the visible-row cap changes), so re-check when those change too.
  createEffect(() => {
    visibleChannels();
    maxVisible();
    scheduleListScrollUpdate();
  });

  onCleanup(() => {
    if (listScrollFrame !== undefined) cancelAnimationFrame(listScrollFrame);
  });

  const snapToTopIfIdle = () => {
    const el = channelListRef;
    if (!el || el.scrollTop === 0) return;
    if (Date.now() - lastUserScrollAt < SCROLL_IDLE_SNAP_MS) return;
    // The programmatic scroll fires a scroll event too; don't let it count
    // as user scrolling.
    suppressNextScrollEvent = true;
    el.scrollTop = 0;
  };

  const unsubscribe = notificationSource.subscribe((notification) => {
    if (!isChannelNotification(notification)) return;
    snapToTopIfIdle();
  });
  onCleanup(unsubscribe);

  const sectionItems = createMemo<CollapsibleSidebarSectionItem[]>(() => [
    {
      id: 'channels-list',
      visible: () => (
        <div class="relative">
          <div
            ref={channelListRef}
            class="flex flex-col gap-0.5 overflow-y-auto overscroll-none"
            style={{ 'max-height': listMaxHeight() }}
            onScroll={() => {
              updateListScrollShadows();
              if (suppressNextScrollEvent) {
                suppressNextScrollEvent = false;
                return;
              }
              lastUserScrollAt = Date.now();
            }}
          >
            <Key each={visibleChannels()} by={(channel) => channel.entity.id}>
              {(channel) => (
                <ChannelRow
                  channel={channel()}
                  onFloatingOpenChange={props.onDropdownOpenChange}
                />
              )}
            </Key>
            <Show when={showAllCaughtUp()}>
              <div class="flex h-7 w-full items-center gap-2 px-2 py-1 text-sm font-medium text-ink-extra-muted/60">
                <span class="truncate">All caught up</span>
              </div>
            </Show>
          </div>
          <div
            class={cn(
              'pointer-events-none absolute inset-x-0 top-0 h-3 transition-opacity bg-gradient-to-b from-surface to-transparent',
              hasOverflowTop() ? 'opacity-100' : 'opacity-0'
            )}
          />
          <div
            class={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-3 transition-opacity bg-gradient-to-t from-surface to-transparent',
              hasOverflowBottom() ? 'opacity-100' : 'opacity-0'
            )}
          />
        </div>
      ),
      dropdown: () => null,
    },
  ]);

  return (
    <Show
      when={!isSlim()}
      fallback={
        <Show when={slimVisible().length > 0}>
          <section class="w-full py-1.5 flex flex-col items-start gap-0.5">
            <Key each={slimVisible()} by={(channel) => channel.entity.id}>
              {(channel) => <ChannelRow channel={channel()} isSlim />}
            </Key>
            <Show when={slimOverflow() > 0}>
              <span class="w-full text-center text-xxs text-ink-muted mt-1">
                +{slimOverflow()}
              </span>
            </Show>
          </section>
        </Show>
      }
    >
      <Show when={recentChannels().length > 0}>
        <CollapsibleSidebarSection
          label="Latest"
          persistKey="recent-channels"
          items={sectionItems()}
          headerWrapper={props.headerWrapper}
          headerMenu={(open) => (
            <Show when={open}>
              <Tooltip
                label="Toggle unread filter"
                placement="top"
                class="pointer-events-none rounded-full opacity-0 transition-opacity duration-100 group-hover/sidebar-section:pointer-events-auto group-hover/sidebar-section:opacity-100"
              >
                <div
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <ToggleSwitch
                    checked={unreadOnly()}
                    onChange={setUnreadOnly}
                    size="xs"
                    label={
                      <span class="text-[11px] font-medium leading-none text-ink-extra-muted/60">
                        Unread
                      </span>
                    }
                    labelClass="flex items-center"
                    controlClass="bg-ink-extra-muted/25 data-checked:bg-accent"
                    class="flex-row-reverse gap-1 rounded-full px-1.5 py-1"
                  />
                </div>
              </Tooltip>
            </Show>
          )}
          onOpenChange={() => props.onSectionOpenChange?.()}
        />
      </Show>
    </Show>
  );
};
