import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import type { UnifiedNotification } from '@notifications/types';
import { openNotification } from '@notifications';
import {
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
  on,
  onMount,
} from 'solid-js';
import ChannelIcon from '@macro-icons/wide/channel.svg?component-solid';
import { UserIcon } from '@core/component/UserIcon';
import { useSenderName } from '@app/component/app-sidebar/utils';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { Tooltip } from '@core/component/Tooltip';
import { globalSplitManager } from '@app/signal/splitLayout';
import { compareDateDesc } from '@core/util/date';
import { ContextMenuContent, MenuItem } from '@core/component/Menu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { getChannelNotificationParams } from '@notifications/notification-navigation';
import { isChannelNotification } from '@notifications/notification-helpers';
import type { SidebarState } from '@app/component/app-sidebar/sidebar';
import { cn } from '@ui/utils/classname';

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
  sidebarState: SidebarState;
  group: ChannelGroup;
  animate?: boolean;
}) {
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

  const isSidebarSlim = () => props.sidebarState === 'slim';

  return (
    <ContextMenu>
      <ContextMenu.Trigger class="w-full">
        <Tooltip
          tooltip={<span class="text-xs">{displayName()}</span>}
          placement="right"
          hide={!isSidebarSlim()}
        >
          <Button
            as={'a'}
            href={`/channel/${props.group.entityId}`}
            class={cn(
              'flex items-center size-full cursor-default rounded-xs',
              isSidebarSlim() ? 'justify-center p-2' : 'justify-start gap-3'
            )}
            draggable={false}
            variant="ghost"
            size={isSidebarSlim() ? 'icon' : 'sm'}
            classList={{
              'opacity-0 -translate-y-2': !isVisible(),
              'opacity-100 translate-y-0': isVisible(),
            }}
            onClick={(e) => {
              if (e.button === 1) return;

              e.preventDefault();
              navigateToLatestNotification(e.shiftKey);
            }}
          >
            <div
              class={cn(
                'relative flex items-center justify-center flex-shrink-0',
                isSidebarSlim() ? 'size-6' : 'size-5'
              )}
            >
              <Show
                when={props.group.isDM && props.group.latestSenderId}
                fallback={
                  <div class="size-4 text-ink-muted">
                    <ChannelIcon />
                  </div>
                }
              >
                <UserIcon
                  id={props.group.latestSenderId!}
                  size={'fill'}
                  suppressClick
                  showTooltip={false}
                />
              </Show>

              <Show when={isSidebarSlim()}>
                <div class="absolute -top-0.5 -right-0.5 size-1.5 bg-accent rounded-full" />
              </Show>
            </div>

            <Show when={!isSidebarSlim()}>
              <span class="text-sm font-medium text-ink truncate">
                {displayName()}
              </span>
            </Show>

            <Show when={count() > 0 && props.sidebarState === 'expanded'}>
              <span class="flex-shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-accent/10 text-accent rounded ml-auto">
                {count()}
              </span>
            </Show>
          </Button>
        </Tooltip>
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

  return (
    <Show when={channelGroups().length > 0}>
      <section
        class={cn(
          'w-full h-full flex flex-col justify-center',
          props.sidebarState === 'slim'
            ? 'px-1 py-2 items-center'
            : 'px-2 py-1.5'
        )}
      >
        <header
          class={cn(
            'text-xs font-medium text-ink-muted ml-2 mb-2',
            props.sidebarState === 'slim' && 'sr-only'
          )}
        >
          <h1>Unread</h1>
        </header>

        <div class="flex-1">
          <For each={channelGroups()}>
            {(group) => (
              <ChannelGroupItem
                sidebarState={props.sidebarState}
                group={group}
                animate={false}
              />
            )}
          </For>
        </div>
      </section>
    </Show>
  );
};
