import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import type { EntityType, NotificationType } from '@core/types';
import type { NotifEvent } from '@service-notification/generated/schemas';
import type { UnifiedNotification } from '@notifications/types';
import { For, Show, createSignal, onMount } from 'solid-js';
import { match } from 'ts-pattern';
import {
  EntityIcon,
  type EntityWithValidIcon,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayNameParts } from '@core/user';
import ArrowBendUpLeftIcon from '@icon/regular/arrow-bend-up-left.svg';
import UserPlusIcon from '@icon/regular/user-plus.svg';
import { Dynamic } from 'solid-js/web';

const UNELIGIBLE_ENTITY_TYPES: EntityType[] = ['email', 'email_thread'];

/** Example notifications for testing - remove before production */
export const EXAMPLE_NOTIFICATIONS: UnifiedNotification[] = [
  // Channel mention - public channel
  {
    id: 'notif_001',
    entity_type: 'channel',
    entity_id: 'ch_general_123',
    notification_event_type: 'channel_mention',
    notification_metadata: {
      tag: 'channel_mention',
      content: {
        channelName: 'general',
        channelType: 'public',
        messageId: 'msg_abc123',
        messageContent: 'Hey @user, can you review this PR?',
        threadId: 'thread_001',
      },
    } as NotifEvent,
    sender_id: 'user_sender_001',
    done: false,
    sent: true,
    created_at: '2026-02-27T10:00:00Z',
    updated_at: '2026-02-27T10:00:00Z',
  },
  // Channel mention - private channel
  {
    id: 'notif_002',
    entity_type: 'channel',
    entity_id: 'ch_private_456',
    notification_event_type: 'channel_mention',
    notification_metadata: {
      tag: 'channel_mention',
      content: {
        channelName: 'secret-project',
        channelType: 'private',
        messageId: 'msg_def456',
        messageContent: '@user please check the latest designs',
      },
    } as NotifEvent,
    sender_id: 'user_sender_002',
    done: false,
    sent: true,
    created_at: '2026-02-27T09:30:00Z',
    updated_at: '2026-02-27T09:30:00Z',
  },
  // Channel message send - DM from Sarah
  {
    id: 'notif_003',
    entity_type: 'channel',
    entity_id: 'ch_dm_789',
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: {
        channelType: 'directMessage',
        messageId: 'msg_ghi789',
        messageContent: 'Quick question about the deployment',
      },
    } as NotifEvent,
    sender_id: 'macro|sarah.chen@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T09:00:00Z',
    updated_at: '2026-02-27T09:00:00Z',
  },
  // Channel message reply - organization channel from David
  {
    id: 'notif_004',
    entity_type: 'channel',
    entity_id: 'ch_org_101',
    notification_event_type: 'channel_message_reply',
    notification_metadata: {
      tag: 'channel_message_reply',
      content: {
        channelName: 'engineering',
        channelType: 'organization',
        messageId: 'msg_jkl012',
        messageContent: 'I agree, we should refactor this module',
        threadId: 'thread_002',
        threadParentSenderId: 'user_thread_owner',
        userId: 'user_replier_001',
      },
    } as NotifEvent,
    sender_id: 'macro|david.park@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T08:45:00Z',
    updated_at: '2026-02-27T08:45:00Z',
  },
  // Channel invite - public
  {
    id: 'notif_005',
    entity_type: 'channel',
    entity_id: 'ch_newchannel_202',
    notification_event_type: 'channel_invite',
    notification_metadata: {
      tag: 'channel_invite',
      content: {
        channelName: 'product-launch',
        channelType: 'public',
      },
    } as NotifEvent,
    sender_id: 'user_sender_005',
    done: false,
    sent: true,
    created_at: '2026-02-27T08:30:00Z',
    updated_at: '2026-02-27T08:30:00Z',
  },
  // Mentioned in document comment
  {
    id: 'notif_007',
    entity_type: 'document',
    entity_id: 'doc_design_456',
    notification_event_type: 'mentioned_in_document_comment',
    notification_metadata: {
      tag: 'mentioned_in_document_comment',
      content: {
        documentName: 'Design System Guidelines',
        fileType: 'document',
        owner: 'user_doc_owner_002',
        commentId: 42,
        threadId: 7,
        mentionId: 'mention_abc123',
        text: '@user Can you clarify the color tokens here?',
      },
    } as NotifEvent,
    sender_id: 'user_sender_007',
    done: false,
    sent: true,
    created_at: '2026-02-27T08:00:00Z',
    updated_at: '2026-02-27T08:00:00Z',
  },
  // Team invite - member role
  {
    id: 'notif_008',
    entity_type: 'team',
    entity_id: 'team_frontend_123',
    notification_event_type: 'invite_to_team',
    notification_metadata: {
      tag: 'invite_to_team',
      content: {
        teamId: 'team_frontend_123',
        teamName: 'Frontend Team',
        invitedBy: 'user_team_lead_001',
        role: 'member',
      },
    } as NotifEvent,
    sender_id: 'user_team_lead_001',
    done: false,
    sent: true,
    created_at: '2026-02-27T07:45:00Z',
    updated_at: '2026-02-27T07:45:00Z',
  },
  // Team invite - admin role
  {
    id: 'notif_009',
    entity_type: 'team',
    entity_id: 'team_platform_456',
    notification_event_type: 'invite_to_team',
    notification_metadata: {
      tag: 'invite_to_team',
      content: {
        teamId: 'team_platform_456',
        teamName: 'Platform Engineering',
        invitedBy: 'user_cto_001',
        role: 'admin',
      },
    } as NotifEvent,
    sender_id: 'user_cto_001',
    done: false,
    sent: true,
    created_at: '2026-02-27T07:30:00Z',
    updated_at: '2026-02-27T07:30:00Z',
  },
  // Task assigned - with task name
  {
    id: 'notif_010',
    entity_type: 'project',
    entity_id: 'proj_webapp_789',
    notification_event_type: 'task_assigned',
    notification_metadata: {
      tag: 'task_assigned',
      content: {
        taskId: 'task_abc123',
        taskName: 'Implement dark mode toggle',
        assignedBy: 'user_pm_001',
      },
    } as NotifEvent,
    sender_id: 'user_pm_001',
    done: false,
    sent: true,
    created_at: '2026-02-27T07:15:00Z',
    updated_at: '2026-02-27T07:15:00Z',
  },
  // Task assigned - without task name
  {
    id: 'notif_011',
    entity_type: 'project',
    entity_id: 'proj_mobile_101',
    notification_event_type: 'task_assigned',
    notification_metadata: {
      tag: 'task_assigned',
      content: {
        taskId: 'task_def456',
        assignedBy: 'user_pm_002',
      },
    } as NotifEvent,
    sender_id: 'user_pm_002',
    done: false,
    sent: true,
    created_at: '2026-02-27T07:00:00Z',
    updated_at: '2026-02-27T07:00:00Z',
  },
  // Viewed notification (read)
  {
    id: 'notif_012',
    entity_type: 'channel',
    entity_id: 'ch_announcements_303',
    notification_event_type: 'channel_mention',
    notification_metadata: {
      tag: 'channel_mention',
      content: {
        channelName: 'announcements',
        channelType: 'organization',
        messageId: 'msg_old123',
        messageContent: 'Reminder about the all-hands meeting',
      },
    } as NotifEvent,
    sender_id: 'user_sender_012',
    done: false,
    sent: true,
    viewed_at: '2026-02-27T06:30:00Z',
    created_at: '2026-02-27T06:00:00Z',
    updated_at: '2026-02-27T06:30:00Z',
  },
  // Done notification
  {
    id: 'notif_013',
    entity_type: 'document',
    entity_id: 'doc_old_789',
    notification_event_type: 'document_mention',
    notification_metadata: {
      tag: 'document_mention',
      content: {
        documentName: 'Old Meeting Notes',
        fileType: 'document',
        owner: 'user_doc_owner_003',
      },
    } as NotifEvent,
    sender_id: 'user_sender_013',
    done: true,
    sent: true,
    viewed_at: '2026-02-26T15:00:00Z',
    created_at: '2026-02-26T14:00:00Z',
    updated_at: '2026-02-26T15:00:00Z',
  },
  // Chat entity - DM from Mike
  {
    id: 'notif_014',
    entity_type: 'chat',
    entity_id: 'chat_support_404',
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: {
        channelType: 'directMessage',
        messageId: 'msg_support_001',
        messageContent: 'Need help with API integration',
      },
    } as NotifEvent,
    sender_id: 'macro|mike.johnson@example.com',
    done: false,
    sent: true,
    created_at: '2026-02-27T06:45:00Z',
    updated_at: '2026-02-27T06:45:00Z',
  },
  // User entity mention
  {
    id: 'notif_015',
    entity_type: 'user',
    entity_id: 'user_colleague_505',
    notification_event_type: 'channel_mention',
    notification_metadata: {
      tag: 'channel_mention',
      content: {
        channelName: 'watercooler',
        channelType: 'public',
        messageId: 'msg_social_001',
        messageContent: '@user Great job on the presentation!',
      },
    } as NotifEvent,
    sender_id: 'user_colleague_505',
    done: false,
    sent: true,
    created_at: '2026-02-27T05:30:00Z',
    updated_at: '2026-02-27T05:30:00Z',
  },
];

type NotificationIconResult =
  | { type: 'entity'; icon: EntityWithValidIcon }
  | { type: 'svg'; icon: typeof ArrowBendUpLeftIcon }
  | { type: 'user' };

function getNotificationIcon(
  type: NotificationType,
  notification: UnifiedNotification
): NotificationIconResult {
  // Check if this is a DM - use user icon instead
  const isDM =
    type === 'channel_message_send' &&
    notification.notification_metadata.tag === 'channel_message_send' &&
    notification.notification_metadata.content.channelType === 'directMessage';

  if (isDM) {
    return { type: 'user' };
  }

  return match(type)
    .with('channel_mention', () => ({
      type: 'entity' as const,
      icon: 'channel' as EntityWithValidIcon,
    }))
    .with('mentioned_in_document_comment', () => ({
      type: 'entity' as const,
      icon: 'write' as EntityWithValidIcon,
    }))
    .with('channel_message_reply', () => ({
      type: 'svg' as const,
      icon: ArrowBendUpLeftIcon,
    }))
    .with('channel_message_send', () => ({
      type: 'entity' as const,
      icon: 'chat' as EntityWithValidIcon,
    }))
    .with('channel_invite', () => ({
      type: 'svg' as const,
      icon: UserPlusIcon,
    }))
    .with('invite_to_team', () => ({
      type: 'svg' as const,
      icon: UserPlusIcon,
    }))
    .with('task_assigned', () => ({
      type: 'entity' as const,
      icon: 'task' as EntityWithValidIcon,
    }))
    .otherwise(() => ({
      type: 'entity' as const,
      icon: 'chat' as EntityWithValidIcon,
    }));
}

function getNotificationLabel(type: NotificationType): string {
  return match(type)
    .with('channel_mention', () => '@You')
    .with('mentioned_in_document_comment', () => '@You')
    .with('channel_message_reply', () => '') // Show sender name instead
    .with('channel_message_send', () => '') // Show sender name instead for DMs
    .with('channel_invite', () => 'Channel invite')
    .with('invite_to_team', () => 'Team invite')
    .with('task_assigned', () => 'New task')
    .otherwise(() => '');
}

function getNotificationContent(notification: UnifiedNotification): string {
  const metadata = notification.notification_metadata;

  return match(metadata)
    .with({ tag: 'channel_mention' }, (m) => m.content.messageContent ?? '')
    .with(
      { tag: 'channel_message_send' },
      (m) => m.content.messageContent ?? ''
    )
    .with(
      { tag: 'channel_message_reply' },
      (m) => m.content.messageContent ?? ''
    )
    .with(
      { tag: 'channel_invite' },
      (m) => m.content.channelName ?? 'a channel'
    )
    .with({ tag: 'mentioned_in_document_comment' }, (m) => m.content.text ?? '')
    .with({ tag: 'invite_to_team' }, (m) => m.content.teamName ?? '')
    .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? 'a task')
    .otherwise(() => '');
}

/** Gets contextual info like channel name or document name */
function getNotificationContext(
  notification: UnifiedNotification
): string | null {
  const metadata = notification.notification_metadata;

  return match(metadata)
    .with({ tag: 'channel_mention' }, (m) =>
      m.content.channelName ? `#${m.content.channelName}` : null
    )
    .with({ tag: 'channel_message_send' }, (m) =>
      m.content.channelName ? `#${m.content.channelName}` : 'DM'
    )
    .with({ tag: 'channel_message_reply' }, (m) =>
      m.content.channelName ? `#${m.content.channelName}` : null
    )
    .with({ tag: 'channel_invite' }, () => null)
    .with(
      { tag: 'mentioned_in_document_comment' },
      (m) => m.content.documentName ?? null
    )
    .with({ tag: 'invite_to_team' }, (m) =>
      m.content.invitedBy ? `by ${m.content.invitedBy}` : null
    )
    .with({ tag: 'task_assigned' }, (m) =>
      m.content.assignedBy ? `by ${m.content.assignedBy}` : null
    )
    .otherwise(() => null);
}

/** Renders the icon for a notification */
function NotificationItemIcon(props: {
  type: NotificationType;
  notification: UnifiedNotification;
}) {
  const iconResult = () => getNotificationIcon(props.type, props.notification);

  return (
    <Show
      when={iconResult().type === 'entity'}
      fallback={
        <Show
          when={iconResult().type === 'user'}
          fallback={
            <Dynamic
              component={
                (
                  iconResult() as {
                    type: 'svg';
                    icon: typeof ArrowBendUpLeftIcon;
                  }
                ).icon
              }
              class="size-4 text-ink-muted"
            />
          }
        >
          <Show when={props.notification.sender_id}>
            {(senderId) => (
              <UserIcon
                id={senderId()}
                size="xs"
                suppressClick
                showTooltip={false}
              />
            )}
          </Show>
        </Show>
      }
    >
      <EntityIcon
        targetType={
          (iconResult() as { type: 'entity'; icon: EntityWithValidIcon }).icon
        }
        size="xs"
      />
    </Show>
  );
}

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
      // Convert "john.doe" to "John"
      const first = namePart.split('.')[0];
      return first.charAt(0).toUpperCase() + first.slice(1);
    }
    return null;
  };
}

function NotificationItem(props: {
  notification: UnifiedNotification;
  animate?: boolean;
}) {
  const [isVisible, setIsVisible] = createSignal(!props.animate);

  onMount(() => {
    if (props.animate) {
      // Small delay to ensure the initial state is rendered first
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    }
  });

  const type = () =>
    props.notification.notification_event_type as NotificationType;
  const label = () => getNotificationLabel(type());
  const content = () => getNotificationContent(props.notification);
  const context = () => getNotificationContext(props.notification);
  const senderName = useSenderName(props.notification.sender_id);

  // Show sender name for DMs and replies
  const isDM = () =>
    type() === 'channel_message_send' &&
    props.notification.notification_metadata.tag === 'channel_message_send' &&
    props.notification.notification_metadata.content.channelType ===
      'directMessage';

  const isReply = () => type() === 'channel_message_reply';

  const showSenderName = () => isDM() || isReply();

  return (
    <div
      class="flex items-start gap-3 p-2 hover:bg-surface-hover cursor-pointer transition-all duration-300 ease-out"
      classList={{
        'opacity-0 -translate-y-2': !isVisible(),
        'opacity-100 translate-y-0': isVisible(),
      }}
    >
      {/* Icon */}
      <div class="flex-shrink-0 mt-1">
        <NotificationItemIcon type={type()} notification={props.notification} />
      </div>

      {/* Content - 3 line layout */}
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        {/* Line 1: Label or Sender name (for DMs and replies) */}
        <span class="text-sm font-medium text-ink truncate">
          <Show when={showSenderName()} fallback={label()}>
            {senderName()}
          </Show>
        </span>

        {/* Line 2: Context (channel name, document name, etc) */}
        <Show when={context()}>
          <span class="text-xs text-ink-muted truncate">{context()}</span>
        </Show>

        {/* Line 3: Message content preview */}
        <Show when={content()}>
          <p class="text-xs text-ink-muted truncate">{content()}</p>
        </Show>
      </div>
    </div>
  );
}

function filterUnreadNotDone(notifications: UnifiedNotification[]) {
  return notifications.filter(
    (n) =>
      !n.viewed_at &&
      !n.done &&
      !UNELIGIBLE_ENTITY_TYPES.includes(n.entity_type)
  );
}

/** Random notification templates for debug button */
const DEBUG_NOTIFICATION_TEMPLATES = [
  {
    type: 'channel_mention',
    entity_type: 'channel' as const,
    metadata: (id: number) =>
      ({
        tag: 'channel_mention',
        content: {
          channelName: ['general', 'engineering', 'design', 'random'][id % 4],
          channelType: 'public',
          messageId: `msg_debug_${id}`,
          messageContent: [
            'Hey @you, can you take a look at this?',
            '@you thoughts on this approach?',
            'Need your input @you',
            '@you this is urgent!',
          ][id % 4],
        },
      }) as NotifEvent,
  },
  {
    type: 'channel_message_send',
    entity_type: 'channel' as const,
    metadata: (id: number) =>
      ({
        tag: 'channel_message_send',
        content: {
          channelType: 'directMessage',
          messageId: `msg_dm_${id}`,
          messageContent: [
            'Hey, got a minute?',
            'Can we sync up later?',
            'Just sent you the files',
            'Thanks for your help!',
          ][id % 4],
        },
      }) as NotifEvent,
    sender_id: [
      'macro|alex.kim@example.com',
      'macro|emma.wilson@example.com',
      'macro|james.taylor@example.com',
      'macro|olivia.brown@example.com',
    ],
  },
  {
    type: 'task_assigned',
    entity_type: 'project' as const,
    metadata: (id: number) =>
      ({
        tag: 'task_assigned',
        content: {
          taskId: `task_debug_${id}`,
          taskName: [
            'Review PR #123',
            'Update documentation',
            'Fix login bug',
            'Deploy to staging',
          ][id % 4],
          assignedBy: 'macro|pm@example.com',
        },
      }) as NotifEvent,
  },
  {
    type: 'channel_message_reply',
    entity_type: 'channel' as const,
    metadata: (id: number) =>
      ({
        tag: 'channel_message_reply',
        content: {
          channelName: 'engineering',
          channelType: 'organization',
          messageId: `msg_reply_${id}`,
          messageContent: [
            'Good point, I agree',
            'Let me check on that',
            "Done! It's ready for review",
            'I have a different perspective...',
          ][id % 4],
          threadId: `thread_${id}`,
          userId: 'macro|replier@example.com',
        },
      }) as NotifEvent,
  },
  {
    type: 'invite_to_team',
    entity_type: 'team' as const,
    metadata: (id: number) =>
      ({
        tag: 'invite_to_team',
        content: {
          teamId: `team_debug_${id}`,
          teamName: ['Platform', 'Mobile', 'Infrastructure', 'Growth'][id % 4],
          invitedBy: 'macro|lead@example.com',
          role: 'member',
        },
      }) as NotifEvent,
  },
];

let debugIdCounter = 1000;

function createDebugNotification(): UnifiedNotification {
  const id = debugIdCounter++;
  const template =
    DEBUG_NOTIFICATION_TEMPLATES[id % DEBUG_NOTIFICATION_TEMPLATES.length];
  const now = new Date().toISOString();

  return {
    id: `notif_debug_${id}`,
    entity_type: template.entity_type,
    entity_id: `${template.entity_type}_debug_${id}`,
    notification_event_type: template.type,
    notification_metadata: template.metadata(id),
    sender_id:
      'sender_id' in template && template.sender_id
        ? template.sender_id[id % template.sender_id.length]
        : `macro|sender${id % 5}@example.com`,
    done: false,
    sent: true,
    created_at: now,
    updated_at: now,
  };
}

export const UnreadWidget = () => {
  const notificationSource = useGlobalNotificationSource();
  const [debugNotifications, setDebugNotifications] = createSignal<
    UnifiedNotification[]
  >([]);
  const [animatingIds, setAnimatingIds] = createSignal<Set<string>>(new Set());

  const allNotifications = () => [
    ...debugNotifications(),
    ...EXAMPLE_NOTIFICATIONS,
  ];
  const filteredNotifications = () => filterUnreadNotDone(allNotifications());

  const addDebugNotification = () => {
    const newNotification = createDebugNotification();
    // Mark this notification for animation
    setAnimatingIds((prev) => new Set([...prev, newNotification.id]));
    setDebugNotifications((prev) => [newNotification, ...prev]);
  };

  return (
    <div class="w-full h-full border-y border-y-edge-muted flex flex-col">
      {/* Debug button */}
      <button
        type="button"
        onClick={addDebugNotification}
        class="m-2 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-accent/90 transition-colors"
      >
        + Add Debug Notification
      </button>

      {/* Notifications list */}
      <div class="flex-1 overflow-y-auto">
        <For each={filteredNotifications()}>
          {(notification) => (
            <NotificationItem
              notification={notification}
              animate={animatingIds().has(notification.id)}
            />
          )}
        </For>
      </div>
    </div>
  );
};
