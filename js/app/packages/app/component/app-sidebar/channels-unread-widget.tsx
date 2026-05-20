import type { SidebarState } from '@app/component/app-sidebar/sidebar';
import { useSenderName } from '@app/component/app-sidebar/utils';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ContextMenuContent, MenuItem } from '@core/component/Menu';
import { UserIcon } from '@core/component/UserIcon';
import { compareDateDesc } from '@core/util/date';
import { ContextMenu } from '@kobalte/core/context-menu';
import { openNotification } from '@notifications';
import { isChannelNotification } from '@notifications/notification-helpers';
import { getChannelNotificationParams } from '@notifications/notification-navigation';
import type { UnifiedNotification } from '@notifications/types';
import { Avatar, Button, cn, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
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

function ChannelLetterIcon(props: { letters: string }) {
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
    <Button
      class={cn(
        'flex items-center cursor-default rounded-md text-ink-extra-muted not-disabled:hover:bg-ink/3',
        isSlim() ? 'justify-center size-8' : 'justify-start gap-2 w-full py-1'
      )}
      draggable={false}
      variant="ghost"
      size="sm"
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
      <div class="relative flex items-center justify-center shrink-0 size-5">
        <Show
          when={isDM() && senderId()}
          fallback={<ChannelLetterIcon letters={props.channelLetters ?? '?'} />}
        >
          <UserIcon
            id={senderId()!}
            size="md"
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
    </Button>
  );

  return (
    <ContextMenu>
      <ContextMenu.Trigger class="w-full">
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

  return (
    <Show when={channelGroups().length > 0}>
      <Show
        when={!isSlim()}
        fallback={
          <section class="w-full p-2 flex flex-col items-center">
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
              <span class="text-xxs text-ink-muted mt-1">
                +{slimOverflow()}
              </span>
            </Show>
          </section>
        }
      >
        <section class="size-full flex flex-col justify-center px-2 py-1.5">
          <header class="text-xs font-medium text-ink-muted ml-2 mb-1">
            <h1>Unread</h1>
          </header>

          <div class="flex-1">
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
        </section>
      </Show>
    </Show>
  );
};
