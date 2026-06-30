import type { SidebarState } from '@app/component/app-sidebar/sidebar';
import { useSenderName } from '@app/component/app-sidebar/utils';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { UserIcon } from '@core/component/UserIcon';
import { compareDateDesc } from '@core/util/date';
import { ContextMenu } from '@kobalte/core/context-menu';
import { openNotification } from '@notifications';
import { isChannelNotification } from '@notifications/notification-helpers';
import { getChannelNotificationParams } from '@notifications/notification-navigation';
import type { UnifiedNotification } from '@notifications/types';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Avatar, cn, NavRow, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
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

  return (
    <ContextMenu>
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
          <ButtonContent />
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

  const channelLettersMap = createMemo(() =>
    computeChannelLetters(channelGroups())
  );

  const isSlim = () => props.sidebarState === 'slim';
  const SLIM_MAX = 4;
  const slimVisible = () => channelGroups().slice(0, SLIM_MAX);
  const slimOverflow = () => Math.max(0, channelGroups().length - SLIM_MAX);
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
    <Show when={channelGroups().length > 0}>
      <Show
        when={!isSlim()}
        fallback={
          <section class="w-full py-1.5 flex flex-col items-start gap-0.5">
            <For each={slimVisible()}>
              {(group) => (
                <ChannelGroupItem
                  group={group}
                  animate={false}
                  isSlim
                  channelLetters={channelLettersMap().get(group.entityId)}
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
              onScroll={updateScrollShadows}
              class="size-full overflow-y-auto overscroll-contain flex flex-col gap-0.5 pr-1 -mr-1"
            >
              <For each={channelGroups()}>
                {(group) => (
                  <ChannelGroupItem
                    group={group}
                    animate={false}
                    channelLetters={channelLettersMap().get(group.entityId)}
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
  );
};
