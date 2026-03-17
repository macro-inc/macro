import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import type { UnifiedNotification } from '@notifications/types';
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
import {
  isChannelNotification,
  useSenderName,
} from '@app/component/app-sidebar/utils';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { globalSplitManager } from '@app/signal/splitLayout';
import { compareDateDesc } from '@core/util/date';

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
      class="flex items-center justify-start gap-3 w-full cursor-default rounded-xs"
      variant="ghost"
      size="sm"
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
            <div class="size-4 text-ink-muted">
              <ChannelIcon />
            </div>
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

  const openChannelIds = createMemo(() => {
    const manager = globalSplitManager();
    if (!manager) return new Set<string>();
    return new Set(
      manager
        .splits()
        .filter((s) => s.content.type === 'channel')
        .map((s) => s.content.id)
    );
  });

  const filteredNotifications = () => filterUnreadNotDone(allNotifications());

  const channelGroupsMap = createMemo(() => {
    const open = openChannelIds();
    const groups = groupByChannel(filteredNotifications());
    for (const id of open) {
      groups.delete(id);
    }
    return groups;
  });

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
      <section class="w-full h-full px-2 py-1.5 flex flex-col justify-center">
        <header class="text-xs font-medium text-ink-muted ml-3">
          <h1>Unread</h1>
        </header>

        <div class="flex-1 overflow-hidden">
          <For each={channelGroups()}>
            {(group) => <ChannelGroupItem group={group} animate={false} />}
          </For>
        </div>
      </section>
    </Show>
  );
};
