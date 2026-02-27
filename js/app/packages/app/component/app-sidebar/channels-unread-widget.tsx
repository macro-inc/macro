import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import type { NotifEvent } from '@service-notification/generated/schemas';
import type { UnifiedNotification } from '@notifications/types';
import { For, Show, createSignal, createMemo, onMount } from 'solid-js';
import {
  EntityIcon,
  type EntityWithValidIcon,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayNameParts } from '@core/user';

/** Channel notification types we care about */
const CHANNEL_NOTIFICATION_TYPES = [
  'channel_mention',
  'channel_message_send',
  'channel_message_reply',
] as const;

type ChannelNotificationType = (typeof CHANNEL_NOTIFICATION_TYPES)[number];

/** Check if notification is a channel/DM notification */
function isChannelNotification(
  notification: UnifiedNotification
): notification is UnifiedNotification & {
  notification_event_type: ChannelNotificationType;
} {
  return CHANNEL_NOTIFICATION_TYPES.includes(
    notification.notification_event_type as ChannelNotificationType
  );
}

/** Get channel info from notification metadata */
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

/** Grouped channel notifications */
interface ChannelGroup {
  entityId: string;
  channelName: string | null;
  channelType: string | null;
  isDM: boolean;
  notifications: UnifiedNotification[];
  latestSenderId: string | null;
}

/** Group notifications by channel entity ID */
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

  // Sort notifications within each group by date (newest first)
  for (const group of groups.values()) {
    group.notifications.sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime()
    );
    // Update latestSenderId to be from the most recent notification
    if (group.isDM && group.notifications[0]?.sender_id) {
      group.latestSenderId = group.notifications[0].sender_id;
    }
  }

  return groups;
}

/** Hook to get sender's first name */
function useSenderName(senderId: string | null | undefined) {
  const nameParts = useDisplayNameParts(tryMacroId(senderId ?? ''));
  return () => {
    const firstName = nameParts.firstName();
    const fullName = nameParts.fullName();
    if (firstName || fullName) {
      return firstName || fullName;
    }
    // Fallback: extract name from macro ID format (macro|email@domain.com)
    if (senderId?.startsWith('macro|')) {
      const email = senderId.slice(6);
      const namePart = email.split('@')[0];
      const first = namePart.split('.')[0];
      return first.charAt(0).toUpperCase() + first.slice(1);
    }
    return null;
  };
}

/** Renders a single channel group item */
function ChannelGroupItem(props: { group: ChannelGroup; animate?: boolean }) {
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
    <div
      class="flex items-center gap-3 p-2 hover:bg-surface-hover cursor-pointer transition-all duration-300 ease-out"
      classList={{
        'opacity-0 -translate-y-2': !isVisible(),
        'opacity-100 translate-y-0': isVisible(),
      }}
    >
      {/* Icon */}
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

      {/* Channel name */}
      <span class="flex-1 text-sm font-medium text-ink truncate">
        {displayName()}
      </span>

      {/* Notification count badge */}
      <Show when={count() > 0}>
        <span class="flex-shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-accent/10 text-accent rounded">
          {count()}
        </span>
      </Show>
    </div>
  );
}

/** Example notifications for testing */
export const EXAMPLE_CHANNEL_NOTIFICATIONS: UnifiedNotification[] = [
  // Multiple mentions in #general
  {
    id: 'ch_notif_001',
    entity_type: 'channel',
    entity_id: 'ch_general_123',
    notification_event_type: 'channel_mention',
    notification_metadata: {
      tag: 'channel_mention',
      content: {
        channelName: 'general',
        channelType: 'public',
        messageId: 'msg_001',
        messageContent: 'Hey @user, can you review this?',
      },
    } as NotifEvent,
    sender_id: 'macro|alice@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T10:00:00Z',
    updated_at: '2026-02-27T10:00:00Z',
  },
  {
    id: 'ch_notif_002',
    entity_type: 'channel',
    entity_id: 'ch_general_123',
    notification_event_type: 'channel_mention',
    notification_metadata: {
      tag: 'channel_mention',
      content: {
        channelName: 'general',
        channelType: 'public',
        messageId: 'msg_002',
        messageContent: '@user thoughts on this?',
      },
    } as NotifEvent,
    sender_id: 'macro|bob@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T09:30:00Z',
    updated_at: '2026-02-27T09:30:00Z',
  },
  // DM from Sarah (multiple messages)
  {
    id: 'ch_notif_003',
    entity_type: 'channel',
    entity_id: 'ch_dm_sarah',
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: {
        channelType: 'directMessage',
        messageId: 'msg_003',
        messageContent: 'Hey, got a minute?',
      },
    } as NotifEvent,
    sender_id: 'macro|sarah.chen@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T09:00:00Z',
    updated_at: '2026-02-27T09:00:00Z',
  },
  {
    id: 'ch_notif_004',
    entity_type: 'channel',
    entity_id: 'ch_dm_sarah',
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: {
        channelType: 'directMessage',
        messageId: 'msg_004',
        messageContent: 'Need to discuss the project',
      },
    } as NotifEvent,
    sender_id: 'macro|sarah.chen@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T08:55:00Z',
    updated_at: '2026-02-27T08:55:00Z',
  },
  {
    id: 'ch_notif_005',
    entity_type: 'channel',
    entity_id: 'ch_dm_sarah',
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: {
        channelType: 'directMessage',
        messageId: 'msg_005',
        messageContent: 'Are you there?',
      },
    } as NotifEvent,
    sender_id: 'macro|sarah.chen@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T08:50:00Z',
    updated_at: '2026-02-27T08:50:00Z',
  },
  // Reply in #engineering
  {
    id: 'ch_notif_006',
    entity_type: 'channel',
    entity_id: 'ch_engineering_456',
    notification_event_type: 'channel_message_reply',
    notification_metadata: {
      tag: 'channel_message_reply',
      content: {
        channelName: 'engineering',
        channelType: 'organization',
        messageId: 'msg_006',
        messageContent: 'I agree with your approach',
        threadId: 'thread_001',
        userId: 'macro|david@example.com',
      },
    } as NotifEvent,
    sender_id: 'macro|david.park@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T08:45:00Z',
    updated_at: '2026-02-27T08:45:00Z',
  },
  // DM from Mike
  {
    id: 'ch_notif_007',
    entity_type: 'channel',
    entity_id: 'ch_dm_mike',
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: {
        channelType: 'directMessage',
        messageId: 'msg_007',
        messageContent: 'Quick question about the API',
      },
    } as NotifEvent,
    sender_id: 'macro|mike.johnson@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T08:30:00Z',
    updated_at: '2026-02-27T08:30:00Z',
  },
];

/** Filters notifications to only show unread and not done */
function filterUnreadNotDone(notifications: UnifiedNotification[]) {
  return notifications.filter((n) => !n.viewed_at && !n.done);
}

/** Debug notification templates - uses same entity IDs as example data to merge */
const DEBUG_CHANNEL_OPTIONS = [
  { entityId: 'ch_general_123', channelName: 'general', channelType: 'public' },
  {
    entityId: 'ch_engineering_456',
    channelName: 'engineering',
    channelType: 'organization',
  },
];

const DEBUG_DM_OPTIONS = [
  { entityId: 'ch_dm_sarah', senderId: 'macro|sarah.chen@example.com' },
  { entityId: 'ch_dm_mike', senderId: 'macro|mike.johnson@example.com' },
  { entityId: 'ch_dm_alex', senderId: 'macro|alex.kim@example.com' },
];

const DEBUG_MESSAGES = {
  mention: [
    'Hey @you, can you take a look?',
    '@you thoughts on this?',
    'Need your input @you',
    '@you this is urgent!',
  ],
  dm: [
    'Hey, got a minute?',
    'Can we sync up later?',
    'Just sent you the files',
    'Thanks for your help!',
  ],
  reply: [
    'Good point, I agree!',
    'Let me check on that',
    "Done, it's ready for review",
    'I have a different perspective...',
  ],
};

let debugIdCounter = 2000;

function createDebugChannelNotification(): UnifiedNotification {
  const id = debugIdCounter++;
  const now = new Date().toISOString();

  // Cycle through: mention, DM, reply
  const notifType = id % 3;

  if (notifType === 1) {
    // DM
    const dm = DEBUG_DM_OPTIONS[id % DEBUG_DM_OPTIONS.length];
    return {
      id: `ch_debug_${id}`,
      entity_type: 'channel',
      entity_id: dm.entityId,
      notification_event_type: 'channel_message_send',
      notification_metadata: {
        tag: 'channel_message_send',
        content: {
          channelType: 'directMessage',
          messageId: `msg_debug_${id}`,
          messageContent: DEBUG_MESSAGES.dm[id % DEBUG_MESSAGES.dm.length],
        },
      } as NotifEvent,
      sender_id: dm.senderId,
      done: false,
      sent: true,
      created_at: now,
      updated_at: now,
    };
  }

  if (notifType === 2) {
    // Reply
    const channel = DEBUG_CHANNEL_OPTIONS[id % DEBUG_CHANNEL_OPTIONS.length];
    return {
      id: `ch_debug_${id}`,
      entity_type: 'channel',
      entity_id: channel.entityId,
      notification_event_type: 'channel_message_reply',
      notification_metadata: {
        tag: 'channel_message_reply',
        content: {
          channelName: channel.channelName,
          channelType: channel.channelType,
          messageId: `msg_debug_${id}`,
          messageContent:
            DEBUG_MESSAGES.reply[id % DEBUG_MESSAGES.reply.length],
          threadId: `thread_debug_${id}`,
          userId: `user_debug_${id}`,
        },
      } as NotifEvent,
      sender_id: `macro|replier${id % 3}@example.com`,
      done: false,
      sent: true,
      created_at: now,
      updated_at: now,
    };
  }

  // Mention (default)
  const channel = DEBUG_CHANNEL_OPTIONS[id % DEBUG_CHANNEL_OPTIONS.length];
  return {
    id: `ch_debug_${id}`,
    entity_type: 'channel',
    entity_id: channel.entityId,
    notification_event_type: 'channel_mention',
    notification_metadata: {
      tag: 'channel_mention',
      content: {
        channelName: channel.channelName,
        channelType: channel.channelType,
        messageId: `msg_debug_${id}`,
        messageContent:
          DEBUG_MESSAGES.mention[id % DEBUG_MESSAGES.mention.length],
      },
    } as NotifEvent,
    sender_id: `macro|mentioner${id % 3}@example.com`,
    done: false,
    sent: true,
    created_at: now,
    updated_at: now,
  };
}

export const ChannelsUnreadWidget = () => {
  const notificationSource = useGlobalNotificationSource();
  const [debugNotifications, setDebugNotifications] = createSignal<
    UnifiedNotification[]
  >([]);
  const [animatingIds, setAnimatingIds] = createSignal<Set<string>>(new Set());

  const allNotifications = () => [
    ...debugNotifications(),
    ...EXAMPLE_CHANNEL_NOTIFICATIONS,
  ];

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

  const addDebugNotification = () => {
    const newNotification = createDebugChannelNotification();
    setAnimatingIds((prev) => new Set([...prev, newNotification.entity_id]));
    setDebugNotifications((prev) => [newNotification, ...prev]);
  };

  return (
    <div class="w-full h-full flex flex-col">
      {/* Debug button */}
      <button
        type="button"
        onClick={addDebugNotification}
        class="fixed bottom-0 right-0 m-2 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-accent/90 transition-colors"
      >
        + Add Debug Notification
      </button>

      {/* Label */}
      <div class="px-2 py-1.5 text-xs font-medium text-ink-muted tracking-wide">
        Unread
      </div>

      {/* Channel groups list */}
      <div class="flex-1 overflow-y-auto">
        <For each={channelGroups()}>
          {(group) => (
            <ChannelGroupItem
              group={group}
              animate={animatingIds().has(group.entityId)}
            />
          )}
        </For>
      </div>
    </div>
  );
};
