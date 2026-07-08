import type { SidebarState } from '@app/component/app-sidebar/sidebar';
import { useSenderName } from '@app/component/app-sidebar/utils';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToChannelMessage } from '@block-channel/utils/link';
import { ReadonlyThread } from '@channel/StandaloneThread';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { UserIcon } from '@core/component/UserIcon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { compareDateDesc } from '@core/util/date';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { openNotification } from '@notifications';
import { isChannelNotification } from '@notifications/notification-helpers';
import { getChannelNotificationParams } from '@notifications/notification-navigation';
import type { UnifiedNotification } from '@notifications/types';
import { channelMessagesByIdsQueryOptions } from '@queries/channel/channel-messages';
import { threadRepliesQueryOptions } from '@queries/channel/thread-replies';
import { queryClient } from '@queries/client';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Avatar, cn, NavRow, Surface, Tooltip } from '@ui';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';

function getChannelInfo(notification: UnifiedNotification): {
  channelName: string | null;
  channelType: string | null;
  isDM: boolean;
} {
  if (!isChannelNotification(notification)) {
    return { channelName: null, channelType: null, isDM: false };
  }

  const meta = notification.notification_metadata;
  const channelType = meta.content.channelType;
  const isDM = channelType === 'directMessage';
  const channelName =
    'channelName' in meta.content ? (meta.content.channelName ?? null) : null;
  return { channelName, channelType, isDM };
}

interface ChannelGroup {
  entityId: string;
  channelName: string | null;
  channelType: string | null;
  isDM: boolean;
  notifications: UnifiedNotification[];
  latestSenderId: string | null;
}

function computeChannelLetters(groups: ChannelGroup[]): Map<string, string> {
  const result = new Map<string, string>();
  const firstLetterCount = new Map<string, number>();

  for (const group of groups) {
    if (group.isDM || !group.channelName) continue;
    const first = group.channelName[0]?.toUpperCase() ?? '';
    firstLetterCount.set(first, (firstLetterCount.get(first) ?? 0) + 1);
  }

  for (const group of groups) {
    if (group.isDM || !group.channelName) continue;
    const name = group.channelName;
    const first = name[0]?.toUpperCase() ?? '';
    const needsTwo = (firstLetterCount.get(first) ?? 0) > 1 && name.length > 1;
    const letters = needsTwo ? first + name[1].toUpperCase() : first;
    result.set(group.entityId, letters);
  }

  return result;
}

function ChannelLetterIcon(props: { letters: string; slim?: boolean }) {
  return (
    <Avatar size="md" class="bg-ink-extra-muted/15 text-ink-muted">
      <Avatar.Fallback>{props.letters}</Avatar.Fallback>
    </Avatar>
  );
}

function groupByChannel(
  notifications: UnifiedNotification[]
): Map<string, ChannelGroup> {
  const groups = new Map<string, ChannelGroup>();

  for (const notification of notifications) {
    if (!isChannelNotification(notification)) continue;

    const entityId = notification.entity_id;
    const info = getChannelInfo(notification);

    if (!groups.has(entityId)) {
      groups.set(entityId, {
        entityId,
        channelName: info.channelName,
        channelType: info.channelType,
        isDM: info.isDM,
        notifications: [],
        latestSenderId: null,
      });
    }

    const group = groups.get(entityId)!;
    group.notifications.push(notification);

    // Track latest sender for DMs
    if (info.isDM && notification.sender_id) {
      group.latestSenderId = notification.sender_id;
    }
  }

  return groups;
}

const HOVER_PREVIEW_COUNT = 3;
const PREVIEW_OPEN_DELAY_MS = 450;
const PREVIEW_WARM_OPEN_DELAY_MS = 100;
const PREVIEW_CLOSE_DELAY_MS = 200;
const PREVIEW_WARM_LINGER_MS = 400;
const PREVIEW_ANCHOR_PIN_MS = 600;

type UnreadPreviewManager = {
  activeGroupId: Accessor<string | null>;
  rowEnter: (groupId: string) => void;
  rowLeave: () => void;
  cardEnter: () => void;
  cardLeave: () => void;
  dismiss: (groupId?: string) => void;
};

// Single source of truth for which row's preview is open, so at most one
// card exists and switching between rows skips the full hover-intent delay.
function createUnreadPreviewManager(): UnreadPreviewManager {
  const [activeGroupId, setActiveGroupId] = createSignal<string | null>(null);
  let warm = false;
  let pendingGroupId: string | null = null;
  let openTimer: number | undefined;
  let closeTimer: number | undefined;
  let warmTimer: number | undefined;

  const clearOpenTimer = () => {
    window.clearTimeout(openTimer);
    openTimer = undefined;
    pendingGroupId = null;
  };

  const clearCloseTimer = () => {
    window.clearTimeout(closeTimer);
    closeTimer = undefined;
  };

  const startWarmLinger = () => {
    warm = true;
    window.clearTimeout(warmTimer);
    warmTimer = window.setTimeout(() => {
      warm = false;
    }, PREVIEW_WARM_LINGER_MS);
  };

  const rowEnter = (groupId: string) => {
    clearCloseTimer();
    clearOpenTimer();
    if (activeGroupId() === groupId) return;
    const delay =
      activeGroupId() !== null || warm
        ? PREVIEW_WARM_OPEN_DELAY_MS
        : PREVIEW_OPEN_DELAY_MS;
    pendingGroupId = groupId;
    openTimer = window.setTimeout(() => {
      openTimer = undefined;
      pendingGroupId = null;
      window.clearTimeout(warmTimer);
      setActiveGroupId(groupId);
    }, delay);
  };

  const scheduleClose = () => {
    clearCloseTimer();
    if (activeGroupId() === null) return;
    closeTimer = window.setTimeout(() => {
      closeTimer = undefined;
      setActiveGroupId(null);
      startWarmLinger();
    }, PREVIEW_CLOSE_DELAY_MS);
  };

  const rowLeave = () => {
    clearOpenTimer();
    scheduleClose();
  };

  const dismiss = (groupId?: string) => {
    if (groupId === undefined || pendingGroupId === groupId) {
      clearOpenTimer();
    }
    if (groupId !== undefined && activeGroupId() !== groupId) return;
    clearCloseTimer();
    if (activeGroupId() !== null) {
      setActiveGroupId(null);
      startWarmLinger();
    }
  };

  createEffect(() => {
    if (activeGroupId() === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  onCleanup(() => {
    clearOpenTimer();
    clearCloseTimer();
    window.clearTimeout(warmTimer);
  });

  return {
    activeGroupId,
    rowEnter,
    rowLeave,
    cardEnter: clearCloseTimer,
    cardLeave: scheduleClose,
    dismiss,
  };
}

const UnreadPreviewContext = createContext<UnreadPreviewManager>();

function useUnreadPreviewManager(): UnreadPreviewManager {
  const manager = useContext(UnreadPreviewContext);
  if (!manager) {
    throw new Error(
      'useUnreadPreviewManager must be used inside UnreadPreviewContext'
    );
  }
  return manager;
}

// Unique thread roots (a reply previews its whole thread), newest first.
function getPreviewThreadRoots(group: ChannelGroup): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const notification of group.notifications) {
    const { messageId, threadId } = getChannelNotificationParams(notification);
    const rootId = threadId ?? messageId;
    if (!rootId || seen.has(rootId)) continue;
    seen.add(rootId);
    roots.push(rootId);
  }
  return roots;
}

// Every notification in the group is unread, so the unread ids per thread
// root are just the notification message ids grouped by root.
function getGroupUnreadInfo(group: ChannelGroup): {
  unreadIdsByRoot: Map<string, string[]>;
  anchorMessageId: string | null;
} {
  const unreadIdsByRoot = new Map<string, string[]>();
  let anchorMessageId: string | null = null;
  for (const notification of group.notifications) {
    const { messageId, threadId } = getChannelNotificationParams(notification);
    if (!messageId) continue;
    const rootId = threadId ?? messageId;
    anchorMessageId ??= messageId;
    const ids = unreadIdsByRoot.get(rootId);
    if (ids) {
      ids.push(messageId);
    } else {
      unreadIdsByRoot.set(rootId, [messageId]);
    }
  }
  return { unreadIdsByRoot, anchorMessageId };
}

function prefetchGroupPreview(group: ChannelGroup) {
  const roots = getPreviewThreadRoots(group).slice(0, HOVER_PREVIEW_COUNT);
  const replyRootIds = new Set<string>();
  for (const notification of group.notifications) {
    const { threadId } = getChannelNotificationParams(notification);
    if (threadId) replyRootIds.add(threadId);
  }

  for (const rootId of roots) {
    const parentOptions = channelMessagesByIdsQueryOptions(group.entityId, [
      rootId,
    ]);
    const parentPrefetch = queryClient.prefetchQuery(parentOptions);
    if (replyRootIds.has(rootId)) {
      void queryClient.prefetchQuery(
        threadRepliesQueryOptions(group.entityId, rootId)
      );
    } else {
      void parentPrefetch.then(() => {
        const parent = queryClient.getQueryData<ApiChannelMessage[]>(
          parentOptions.queryKey
        )?.[0];
        if ((parent?.thread.reply_count ?? 0) > 0) {
          void queryClient.prefetchQuery(
            threadRepliesQueryOptions(group.entityId, rootId)
          );
        }
      });
    }
  }
}

function PreviewThreadSkeleton() {
  return (
    <div class="flex flex-col gap-3 px-3 py-2 animate-pulse">
      <div class="flex items-center gap-2">
        <div class="size-5 rounded-full bg-ink/10" />
        <div class="h-3 w-24 rounded-sm bg-ink/10" />
      </div>
      <div class="flex flex-col gap-1.5">
        <div class="h-3 w-full rounded-sm bg-ink/10" />
        <div class="h-3 w-2/3 rounded-sm bg-ink/10" />
      </div>
    </div>
  );
}

function GroupHoverPreview(props: { group: ChannelGroup }) {
  const orchestrator = useGlobalBlockOrchestrator();
  const roots = () => getPreviewThreadRoots(props.group);
  // Show the latest few threads oldest → newest, like the channel reads.
  const visible = () => roots().slice(0, HOVER_PREVIEW_COUNT).reverse();
  const hiddenCount = () => roots().length - visible().length;
  const unreadInfo = createMemo(() => getGroupUnreadInfo(props.group));

  let scrollRef: HTMLDivElement | undefined;

  // Pin the newest unread message into view while async thread content
  // settles, until the user scrolls the card themselves.
  onMount(() => {
    const container = scrollRef;
    if (!container) return;
    const anchorId = unreadInfo().anchorMessageId;
    const startedAt = performance.now();
    let cancelled = false;
    let frame: number | undefined;

    const cancel = () => {
      cancelled = true;
    };
    container.addEventListener('wheel', cancel, { passive: true });
    container.addEventListener('pointerdown', cancel);

    const pin = () => {
      frame = undefined;
      if (cancelled) return;
      const target = anchorId
        ? container.querySelector<HTMLElement>(
            `[data-message-id="${anchorId}"]`
          )
        : null;
      if (target) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const bottomDelta = targetRect.bottom - containerRect.bottom;
        const topDelta = targetRect.top - containerRect.top;
        if (bottomDelta > 0) {
          container.scrollTop += bottomDelta;
        } else if (topDelta < 0) {
          container.scrollTop += topDelta;
        }
      } else {
        container.scrollTop = container.scrollHeight;
      }
      if (performance.now() - startedAt < PREVIEW_ANCHOR_PIN_MS) {
        frame = requestAnimationFrame(pin);
      }
    };
    frame = requestAnimationFrame(pin);

    onCleanup(() => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      container.removeEventListener('wheel', cancel);
      container.removeEventListener('pointerdown', cancel);
    });
  });

  return (
    <div
      ref={scrollRef}
      class="w-90 min-h-12 max-h-96 overflow-y-auto overscroll-contain flex flex-col py-1"
    >
      <Show when={hiddenCount() > 0}>
        <span class="px-3 py-1 text-xs text-ink-extra-muted">
          +{hiddenCount()} earlier
        </span>
      </Show>
      <For each={visible()}>
        {(rootMessageId) => (
          <ReadonlyThread
            channelId={props.group.entityId}
            messageId={rootMessageId}
            unreadMessageIds={unreadInfo().unreadIdsByRoot.get(rootMessageId)}
            fallback={<PreviewThreadSkeleton />}
            onClickMessage={(clickedMessageId, e) => {
              e.stopPropagation();
              const isReply = clickedMessageId !== rootMessageId;
              navigateToChannelMessage(
                orchestrator,
                props.group.entityId,
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
  props: ParentProps<{ group: ChannelGroup; disabled?: boolean }>
) {
  const manager = useUnreadPreviewManager();
  const groupId = () => props.group.entityId;
  const open = () => manager.activeGroupId() === groupId() && !props.disabled;

  createEffect(() => {
    if (props.disabled) manager.dismiss(groupId());
  });

  onCleanup(() => manager.dismiss(groupId()));

  return (
    <Show when={!isTouchDevice()} fallback={props.children}>
      <KobalteTooltip
        open={open()}
        triggerOnFocusOnly={true}
        placement="right"
        overflowPadding={16}
        fitViewport={true}
        flip={true}
        gutter={4}
      >
        <KobalteTooltip.Trigger
          class="inline-flex items-center w-full"
          as="div"
          onPointerEnter={(e: PointerEvent) => {
            if (e.pointerType === 'touch') return;
            prefetchGroupPreview(props.group);
            manager.rowEnter(groupId());
          }}
          onPointerLeave={(e: PointerEvent) => {
            if (e.pointerType === 'touch') return;
            manager.rowLeave();
          }}
        >
          {props.children}
        </KobalteTooltip.Trigger>
        <KobalteTooltip.Portal>
          <KobalteTooltip.Content
            class="z-tool-tip max-w-[calc(100vw-32px)] menu-open-animation"
            onPointerEnter={() => manager.cardEnter()}
            onPointerLeave={() => manager.cardLeave()}
          >
            <Surface depth={3}>
              <GroupHoverPreview group={props.group} />
            </Surface>
          </KobalteTooltip.Content>
        </KobalteTooltip.Portal>
      </KobalteTooltip>
    </Show>
  );
}

function ChannelGroupItem(props: {
  group: ChannelGroup;
  animate?: boolean;
  isSlim?: boolean;
  channelLetters?: string;
}) {
  const notificationSource = useGlobalNotificationSource();
  const [isVisible, setIsVisible] = createSignal(!props.animate);

  onMount(() => {
    if (props.animate) {
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    }
  });

  const senderName = useSenderName(props.group.latestSenderId);
  const count = () => props.group.notifications.length;

  const isDM = () => props.group.isDM;
  const senderId = () => props.group.latestSenderId;

  const displayName = () => {
    if (props.group.isDM) {
      return senderName() ?? 'Direct Message';
    }
    return props.group.channelName
      ? `#${props.group.channelName}`
      : 'Unknown Channel';
  };

  const latestNotification = () => props.group.notifications[0];

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? false;

  const navigateToLatestNotification = (newSplit = false) => {
    const manager = globalSplitManager();
    if (!manager) return;
    const notification = latestNotification();
    openNotification(notification, manager, newSplit);
  };

  const openInCurrentSplit = () => {
    navigateToLatestNotification(false);
  };

  const openInNewSplit = () => {
    if (!canOpenInNewSplit()) return;
    navigateToLatestNotification(true);
  };

  const markAllAsDone = () => {
    void notificationSource.bulkMarkAsDone(props.group.notifications);
  };

  const markAllAsRead = () => {
    void notificationSource.bulkMarkAsRead(props.group.notifications);
  };

  const _openFullscreen = () => {
    const { params } = getChannelNotificationParams(latestNotification());
    globalSplitManager()?.createPopoverSplit({
      content: {
        type: 'channel',
        id: props.group.entityId,
        params,
      },
    });
  };

  const isSlim = () => props.isSlim ?? false;

  const ButtonContent = () => (
    <NavRow
      class={cn(
        'transition-[opacity,transform] justify-start gap-2 w-full h-8 p-1.25'
      )}
      draggable={false}
      classList={{
        'opacity-0 -translate-y-2': !isVisible(),
        'opacity-100 translate-y-0': isVisible(),
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        navigateToLatestNotification(e.shiftKey);
      }}
    >
      <div
        class={cn('relative flex items-center justify-center shrink-0 size-5')}
      >
        <Show
          when={isDM() && senderId()}
          fallback={
            <ChannelLetterIcon
              letters={props.channelLetters ?? '?'}
              slim={isSlim()}
            />
          }
        >
          <UserIcon
            id={senderId()!}
            size={'md'}
            suppressClick
            showTooltip={false}
          />
        </Show>
        <Show when={isSlim()}>
          <div class="absolute -top-0.5 -right-0.5 size-1.5 bg-accent rounded-full ring-surface ring-2" />
        </Show>
      </div>

      <Show when={!isSlim()}>
        <span class="text-sm font-medium truncate">{displayName()}</span>

        <Show when={count() > 0}>
          <span class="shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-ink/6 text-ink-muted rounded-md ml-auto">
            {count()}
          </span>
        </Show>
      </Show>
    </NavRow>
  );

  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenu.Trigger
        class={cn(isSlim() ? 'flex justify-center' : 'w-full')}
      >
        <Show
          when={!isSlim()}
          fallback={
            <Tooltip label={displayName()} placement="right">
              <ButtonContent />
            </Tooltip>
          }
        >
          <UnreadHoverCard group={props.group} disabled={contextMenuOpen()}>
            <ButtonContent />
          </UnreadHoverCard>
        </Show>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenuContent class="text-xs text-ink-muted">
          <MenuItem
            text="Open in new split"
            onClick={openInNewSplit}
            disabled={!canOpenInNewSplit()}
          />
          {/* FIXME: this doesn't work yet */}
          {/* <MenuItem text="Open fullscreen" onClick={openFullscreen} /> */}
          <MenuItem text="Open in current split" onClick={openInCurrentSplit} />
          <MenuItem text="Mark all as read" onClick={markAllAsRead} />
          <MenuItem text="Mark all as done" onClick={markAllAsDone} />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

function filterUnreadNotDone(notifications: UnifiedNotification[]) {
  return notifications.filter((n) => !n.viewed_at && !n.done);
}

export const ChannelsUnreadWidget = (props: { sidebarState: SidebarState }) => {
  const notificationSource = useGlobalNotificationSource();
  const previewManager = createUnreadPreviewManager();
  const allNotifications = () => [...notificationSource.notifications()];

  const filteredNotifications = () => filterUnreadNotDone(allNotifications());

  const channelGroupsMap = createMemo(() =>
    groupByChannel(filteredNotifications())
  );

  const [orderedIds, setOrderedIds] = createSignal<string[]>([]);

  createEffect(
    on(channelGroupsMap, (groups) => {
      const currentIds = new Set(groups.keys());
      const prev = orderedIds();
      const kept = prev.filter((id) => currentIds.has(id));
      const keptSet = new Set(kept);
      const added = [...currentIds].filter((id) => !keptSet.has(id));

      if (added.length === 0 && kept.length === prev.length) return;

      added.sort((a, b) => {
        const aTime = groups.get(a)?.notifications[0]?.created_at;
        const bTime = groups.get(b)?.notifications[0]?.created_at;
        return compareDateDesc(aTime, bTime);
      });

      setOrderedIds([...added, ...kept]);
    })
  );

  const channelGroups = createMemo(() => {
    const groups = channelGroupsMap();
    return orderedIds()
      .map((id) => groups.get(id))
      .filter((g): g is ChannelGroup => g != null);
  });

  // Iterate stable entity ids so notification refreshes update rows in place
  // instead of remounting them, which would close an open hover preview.
  const visibleGroupIds = createMemo(() =>
    orderedIds().filter((id) => channelGroupsMap().has(id))
  );

  const groupById = (id: string) => channelGroupsMap().get(id)!;

  const channelLettersMap = createMemo(() =>
    computeChannelLetters(channelGroups())
  );

  const isSlim = () => props.sidebarState === 'slim';
  const SLIM_MAX = 4;
  const slimVisibleIds = () => visibleGroupIds().slice(0, SLIM_MAX);
  const slimOverflow = () => Math.max(0, visibleGroupIds().length - SLIM_MAX);
  const [hasOverflowTop, setHasOverflowTop] = createSignal(false);
  const [hasOverflowBottom, setHasOverflowBottom] = createSignal(false);
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();
  const [scrollFrameRef, setScrollFrameRef] = createSignal<HTMLDivElement>();
  const scrollSize = createElementSize(scrollRef);
  const scrollFrameSize = createElementSize(scrollFrameRef);
  let scrollShadowFrame: number | undefined;
  let detachScrollShadowObservers: VoidFunction | undefined;

  const updateScrollShadows = () => {
    const el = scrollRef();
    if (!el) return;
    const maxScrollTop = el.scrollHeight - el.clientHeight;
    setHasOverflowTop(el.scrollTop > 1);
    setHasOverflowBottom(maxScrollTop - el.scrollTop > 1);
  };

  const scheduleScrollShadowUpdate = () => {
    if (scrollShadowFrame !== undefined) {
      cancelAnimationFrame(scrollShadowFrame);
    }
    scrollShadowFrame = requestAnimationFrame(() => {
      scrollShadowFrame = undefined;
      updateScrollShadows();
    });
  };

  const detachScrollObservers = () => {
    detachScrollShadowObservers?.();
    detachScrollShadowObservers = undefined;
  };

  const attachScrollEl = (el: HTMLDivElement) => {
    detachScrollObservers();
    setScrollRef(el);

    const mutationObserver = new MutationObserver(scheduleScrollShadowUpdate);
    const sidebarRoot = el.closest('[data-expanded]');

    mutationObserver.observe(sidebarRoot ?? el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    scheduleScrollShadowUpdate();

    detachScrollShadowObservers = () => {
      mutationObserver.disconnect();
    };
  };

  onCleanup(() => {
    detachScrollObservers();
    if (scrollShadowFrame !== undefined) {
      cancelAnimationFrame(scrollShadowFrame);
    }
  });

  createEffect(
    on(channelGroups, () => {
      scheduleScrollShadowUpdate();
    })
  );

  createEffect(() => {
    scrollSize.width;
    scrollSize.height;
    scrollFrameSize.width;
    scrollFrameSize.height;
    scheduleScrollShadowUpdate();
  });

  return (
    <UnreadPreviewContext.Provider value={previewManager}>
      <Show when={channelGroups().length > 0}>
        <Show
          when={!isSlim()}
          fallback={
            <section class="w-full py-1.5 flex flex-col items-start gap-0.5">
              <For each={slimVisibleIds()}>
                {(entityId) => (
                  <ChannelGroupItem
                    group={groupById(entityId)}
                    animate={false}
                    isSlim
                    channelLetters={channelLettersMap().get(entityId)}
                  />
                )}
              </For>
              <Show when={slimOverflow() > 0}>
                <span class="w-full text-center text-xxs text-ink-muted mt-1">
                  +{slimOverflow()}
                </span>
              </Show>
            </section>
          }
        >
          <section class="size-full min-h-0 flex flex-col px-0 py-1.5">
            <header class="shrink-0 text-xs font-medium text-ink-extra-muted/50 my-1 px-1">
              <h1>Unread</h1>
            </header>

            <div ref={setScrollFrameRef} class="relative min-h-0 flex-1">
              <div
                ref={attachScrollEl}
                onScroll={() => {
                  updateScrollShadows();
                  previewManager.dismiss();
                }}
                class="size-full overflow-y-auto overscroll-contain flex flex-col gap-0.5 pr-1 -mr-1"
              >
                <For each={visibleGroupIds()}>
                  {(entityId) => (
                    <ChannelGroupItem
                      group={groupById(entityId)}
                      animate={false}
                      channelLetters={channelLettersMap().get(entityId)}
                    />
                  )}
                </For>
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
          </section>
        </Show>
      </Show>
    </UnreadPreviewContext.Provider>
  );
};
