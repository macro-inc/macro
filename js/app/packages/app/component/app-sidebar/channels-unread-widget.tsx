import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import type { UnifiedNotification } from '@notifications/types';
import { For, Show, createSignal, createMemo, onMount } from 'solid-js';
import {
  EntityIcon,
  type EntityWithValidIcon,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import {
  isChannelNotification,
  useSenderName,
} from '@app/component/app-sidebar/utils';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { useSplitLayout } from '@app/component/split-layout/layout';

function getChannelInfo(notification: UnifiedNotification): {
  channelName: string | null;
  channelType: string | null;
  isDM: boolean;
} {
  const metadata = notification.notification_metadata;

  if (
    metadata.tag === 'channel_mention' ||
    metadata.tag === 'channel_message_send' ||
    metadata.tag === 'channel_message_reply'
  ) {
    const channelType = metadata.content.channelType;
    const isDM = channelType === 'directMessage';
    return {
      channelName:
        'channelName' in metadata.content
          ? (metadata.content.channelName ?? null)
          : null,
      channelType,
      isDM,
    };
  }

  return { channelName: null, channelType: null, isDM: false };
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

function ChannelGroupItem(props: { group: ChannelGroup; animate?: boolean }) {
  const layout = useSplitLayout();

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

  return (
    <Button
      as={'a'}
      href={`/channel/${props.group.entityId}`}
      class="flex items-center justify-start gap-3 w-full"
      variant="ghost"
      classList={{
        'opacity-0 -translate-y-2': !isVisible(),
        'opacity-100 translate-y-0': isVisible(),
      }}
      onClick={(e) => {
        // Middle mouse handling
        if (e.button === 1) return;

        e.preventDefault();
        layout.openWithSplit(
          {
            type: 'channel',
            id: props.group.entityId,
          },
          {
            preferNewSplit: e.shiftKey,
          }
        );
      }}
    >
      <div class="flex-shrink-0">
        <Show
          when={props.group.isDM && props.group.latestSenderId}
          fallback={
            <EntityIcon
              targetType={
                (props.group.channelType ?? 'channel') as EntityWithValidIcon
              }
              size="xs"
            />
          }
        >
          <UserIcon
            id={props.group.latestSenderId!}
            size="xs"
            suppressClick
            showTooltip={false}
          />
        </Show>
      </div>

      <span class="text-sm font-medium text-ink truncate">{displayName()}</span>

      <Show when={count() > 0}>
        <span class="flex-shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-accent/10 text-accent rounded ml-auto">
          {count()}
        </span>
      </Show>
    </Button>
  );
}

function filterUnreadNotDone(notifications: UnifiedNotification[]) {
  return notifications.filter((n) => !n.viewed_at && !n.done);
}

export const ChannelsUnreadWidget = () => {
  const notificationSource = useGlobalNotificationSource();
  const allNotifications = () => [...notificationSource.notifications()];

  const filteredNotifications = () => filterUnreadNotDone(allNotifications());

  const channelGroups = createMemo(() => {
    const groups = groupByChannel(filteredNotifications());
    // Convert to array and sort by most recent notification
    return Array.from(groups.values()).sort((a, b) => {
      const aTime = new Date(a.notifications[0]?.created_at ?? 0).getTime();
      const bTime = new Date(b.notifications[0]?.created_at ?? 0).getTime();
      return bTime - aTime;
    });
  });

  return (
    <section class="w-full h-full px-2 py-1.5 flex flex-col justify-center">
      <header class="text-xs font-medium text-ink-muted tracking-wide">
        <h1>Unread</h1>
      </header>

      <div class="flex-1 overflow-y-auto">
        <For
          each={channelGroups()}
          fallback={<span class="text-ink/80 text-xs">No unread messages</span>}
        >
          {(group) => <ChannelGroupItem group={group} animate={false} />}
        </For>
      </div>
    </section>
  );
};
