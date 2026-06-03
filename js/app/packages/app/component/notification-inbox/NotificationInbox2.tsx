import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import GithubIcon from '@icon/mcp-github.svg';
import ChannelIcon from '@icon/wide-channel.svg';
import EmailIcon from '@icon/wide-email.svg';
import FilesIcon from '@icon/wide-files.svg';
import TaskIcon from '@icon/wide-task.svg';
import type { UnifiedNotification } from '@notifications';
import FunnelIcon from '@phosphor/funnel.svg';
import SortAscendingIcon from '@phosphor/sort-ascending.svg';
import StackIcon from '@phosphor/stack.svg';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import SparkleIcon from '@phosphor-icons/core/regular/sparkle.svg?component-solid';
import type { GithubPrEventStatus } from '@service-notification/generated/schemas';
import { Button, cn } from '@ui';
import { createEffect, For, type JSX, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';
import {
  GithubNotificationListEntity,
  NotificationListEntity,
} from './NotificationListEntity';

const getNotificationTime = (notification: UnifiedNotification): number => {
  const time = Date.parse(
    notification.created_at ?? notification.updated_at ?? ''
  );
  return Number.isNaN(time) ? 0 : time;
};

type NotificationSubItem = {
  notification: UnifiedNotification;
  collapsedCount: number;
  collapsedNotifications: UnifiedNotification[];
};

type NotificationVisualGroup = {
  id: string;
  label: string;
  subItems: NotificationSubItem[];
  subtitle?: string;
  authorId?: string;
  authorFallback?: string;
  icon: (props: { class?: string }) => JSX.Element;
  kind: 'default' | 'github' | 'email' | 'ai';
  notifications: UnifiedNotification[];
};

const getNotificationRoot = (
  notification: UnifiedNotification
): Omit<NotificationVisualGroup, 'notifications'> => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
      return {
        id: `channel:${notification.entity_id}`,
        label: metadata.content.channelName ?? 'Direct message',
        subItems: [],
        subtitle: 'Channel',
        icon: ChannelIcon,
        kind: 'default',
      };
    case 'github_pr_event':
      return {
        id: `github:${metadata.content.foreignEntityId || metadata.content.githubKey}`,
        label: metadata.content.title || metadata.content.displayName,
        subItems: [],
        subtitle: `${metadata.content.owner}/${metadata.content.repo}#${metadata.content.number}`,
        authorId: notification.sender_id ?? undefined,
        authorFallback: metadata.content.senderGithubLogin ?? undefined,
        icon: GithubIcon,
        kind: 'github',
      };
    case 'new_email':
      return {
        id: `email:sender:${metadata.content.sender || notification.sender_id || 'unknown'}`,
        label: metadata.content.sender || 'Email',
        subItems: [],
        subtitle: 'Email',
        icon: EmailIcon,
        kind: 'email',
      };
    case 'document_mention':
      return {
        id: `document:${notification.entity_id}`,
        label: metadata.content.documentName,
        subItems: [],
        subtitle: 'Document',
        icon: FilesIcon,
        kind: 'default',
      };
    case 'mentioned_in_document_comment':
    case 'replied_to_document_comment_thread':
    case 'commented_on_document':
      return {
        id: `document:${notification.entity_id}`,
        label: metadata.content.documentName,
        subItems: [],
        subtitle: 'Document comments',
        icon: FilesIcon,
        kind: 'default',
      };
    case 'task_assigned':
      return {
        id: `task:${notification.entity_id}`,
        label: metadata.content.taskName ?? 'Task',
        subItems: [],
        subtitle: 'Task',
        icon: TaskIcon,
        kind: 'default',
      };
    case 'channel_invite':
      return {
        id: `channel:${notification.entity_id}`,
        label: metadata.content.channelName ?? 'Channel',
        subItems: [],
        subtitle: 'Channel invite',
        icon: ChannelIcon,
        kind: 'default',
      };
    case 'invite_to_team':
      return {
        id: `team:${notification.entity_id}`,
        label: metadata.content.teamName,
        subItems: [],
        subtitle: 'Team invite',
        icon: ChannelIcon,
        kind: 'default',
      };
    case 'ai_response':
      return {
        id: `chat:${notification.entity_id}`,
        label: 'AI response',
        subItems: [],
        subtitle: 'Chat',
        icon: SparkleIcon,
        kind: 'ai',
      };
  }
};

const isGithubStatusNotification = (
  notification: UnifiedNotification
): boolean => {
  const metadata = notification.notification_metadata;
  if (metadata.tag !== 'github_pr_event') return false;

  return (
    metadata.content.action === 'opened' ||
    metadata.content.action === 'reopened' ||
    metadata.content.action === 'closed' ||
    (!!metadata.content.previousStatus &&
      metadata.content.previousStatus !== metadata.content.status)
  );
};

const getGithubGroupStatus = (
  group: NotificationVisualGroup
): GithubPrEventStatus | undefined => {
  if (group.kind !== 'github') return undefined;
  const notification = group.notifications.find(
    (notification) =>
      notification.notification_metadata.tag === 'github_pr_event'
  );
  const metadata = notification?.notification_metadata;
  return metadata?.tag === 'github_pr_event'
    ? metadata.content.status
    : undefined;
};

const getGithubGroupUrl = (
  group: NotificationVisualGroup
): string | undefined => {
  if (group.kind !== 'github') return undefined;
  const notification = group.notifications.find(
    (notification) =>
      notification.notification_metadata.tag === 'github_pr_event'
  );
  const metadata = notification?.notification_metadata;
  return metadata?.tag === 'github_pr_event' ? metadata.content.url : undefined;
};

type NotificationListItem =
  | { id: string; type: 'group'; group: NotificationVisualGroup }
  | { id: string; type: 'notification'; notification: UnifiedNotification };

const shouldRenderStandalone = (
  root: Omit<NotificationVisualGroup, 'notifications'>,
  notifications: UnifiedNotification[]
): boolean =>
  (root.kind === 'email' || root.kind === 'ai') && notifications.length === 1;

const getCollapseThreadKey = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'new_email':
      return `email:${metadata.content.threadId}`;
    case 'channel_mention':
      return metadata.content.threadId
        ? `channel:${notification.entity_id}:thread:${metadata.content.threadId}`
        : undefined;
    case 'channel_message_reply':
      return `channel:${notification.entity_id}:thread:${metadata.content.threadId}`;
    case 'channel_message_send':
      return `channel:${notification.entity_id}:sender:${metadata.content.sender}`;
    default:
      return undefined;
  }
};

const collapseConsecutiveThreadItems = (
  notifications: UnifiedNotification[]
): NotificationSubItem[] => {
  const items: NotificationSubItem[] = [];

  for (const notification of notifications) {
    const previous = items[items.length - 1];
    const threadKey = getCollapseThreadKey(notification);

    if (
      previous &&
      threadKey &&
      getCollapseThreadKey(previous.notification) === threadKey
    ) {
      previous.collapsedCount += 1;
      previous.collapsedNotifications.push(notification);
      continue;
    }

    items.push({
      notification,
      collapsedCount: 1,
      collapsedNotifications: [notification],
    });
  }

  return items;
};

const groupNotifications = (
  notifications: UnifiedNotification[]
): NotificationListItem[] => {
  const groups = new Map<string, UnifiedNotification[]>();

  for (const notification of notifications) {
    const root = getNotificationRoot(notification);
    groups.set(root.id, [...(groups.get(root.id) ?? []), notification]);
  }

  return Array.from(groups, ([, notifications]) => {
    const sorted = notifications.toSorted(
      (a, b) => getNotificationTime(b) - getNotificationTime(a)
    );
    const root = getNotificationRoot(sorted[0]);

    if (shouldRenderStandalone(root, sorted)) {
      return {
        id: `notification:${sorted[0].id}`,
        type: 'notification' as const,
        notification: sorted[0],
      };
    }

    const subItems =
      root.kind === 'github'
        ? sorted
            .filter((notification) => !isGithubStatusNotification(notification))
            .map((notification) => ({
              notification,
              collapsedCount: 1,
              collapsedNotifications: [notification],
            }))
        : collapseConsecutiveThreadItems(sorted);

    return {
      id: `group:${root.id}`,
      type: 'group' as const,
      group: {
        ...root,
        subItems,
        notifications: sorted,
      },
    };
  }).toSorted((a, b) => {
    const aTime =
      a.type === 'group'
        ? getNotificationTime(a.group.notifications[0])
        : getNotificationTime(a.notification);
    const bTime =
      b.type === 'group'
        ? getNotificationTime(b.group.notifications[0])
        : getNotificationTime(b.notification);
    return bTime - aTime;
  });
};

export function NotificationInbox2() {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();

  createEffect(() => {
    panel.handle.setDisplayName('Inbox 2');
  });

  const [notificationItems, setNotificationItems] = createStore<
    NotificationListItem[]
  >([]);

  createEffect(() => {
    const next = groupNotifications(
      notificationSource
        .notifications()
        .filter((notification) => !notification.deleted_at)
    );

    setNotificationItems(reconcile(next, { key: 'id' }));
  });

  return (
    <div class="size-full flex flex-col" data-list-view="inbox2">
      <div class="flex flex-col w-full">
        <SplitHeaderLeft>
          <div class="h-full flex gap-3 items-center shrink-0">
            <span class="text-base font-bold">Inbox 2</span>
          </div>
        </SplitHeaderLeft>
        <SplitToolbarLeft>
          <div class="flex items-start gap-1 min-w-0 flex-1">
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
              disabled
            >
              <SortAscendingIcon class="size-3.5" />
              <span>Sort</span>
            </Button>
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
              disabled
            >
              <StackIcon class="size-3.5" />
              <span>Group</span>
            </Button>
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
              disabled
            >
              <FunnelIcon class="size-3.5" />
              <span>Filter</span>
            </Button>
          </div>
        </SplitToolbarLeft>
        <SplitToolbarRight>
          <Button
            variant="base"
            size="sm"
            depth={2}
            class="bg-surface"
            disabled
          >
            <EyeIcon class="size-3.5" />
            <span>Preview</span>
          </Button>
        </SplitToolbarRight>
      </div>

      <div class="relative grow min-h-1 flex max-sm:flex-col flex-row size-full">
        <div class="@container/u-list size-full unified-list-root flex flex-col">
          <Show
            when={!notificationSource.isLoading()}
            fallback={<LoadingBlock />}
          >
            <Show
              when={notificationItems.length > 0}
              fallback={
                <div class="flex size-full items-center justify-center text-sm text-ink-muted">
                  No notifications
                </div>
              }
            >
              <div class="unified-table-body w-full flex flex-col gap-1 flex-1 min-h-0 relative overflow-y-auto p-2">
                <For each={notificationItems}>
                  {(item) => (
                    <Show
                      when={item.type === 'group' ? item.group : undefined}
                      fallback={
                        <NotificationListEntity
                          notification={
                            item.type === 'notification'
                              ? item.notification
                              : item.group.notifications[0]
                          }
                        />
                      }
                    >
                      {(group) => (
                        <section class="flex flex-col gap-1">
                          <Show
                            when={group().kind === 'github'}
                            fallback={
                              <div
                                class={cn(
                                  'group/header rounded-lg px-2 py-2 flex items-center gap-2.5 text-xs font-semibold tracking-tight text-ink-muted bg-surface hover:ring hover:ring-inset hover:ring-edge border border-edge-muted relative',
                                  {
                                    'border-none': !group().subItems.length,
                                  }
                                )}
                              >
                                <div class="shrink-0 rounded-xs bg-ink-muted/6 flex items-center justify-center text-ink-muted">
                                  <Dynamic
                                    component={group().icon}
                                    class="size-3.5"
                                  />
                                </div>
                                <div class="min-w-0 flex-1 flex items-center gap-1.5">
                                  <span class="truncate text-ink-muted">
                                    {group().label}
                                  </span>
                                </div>
                              </div>
                            }
                          >
                            <div
                              class={cn(
                                'group/header rounded-lg bg-surface hover:ring hover:ring-inset hover:ring-edge border border-edge-muted relative overflow-hidden',
                                {
                                  'border-none': !group().subItems.length,
                                }
                              )}
                            >
                              <GithubNotificationListEntity
                                notification={group().notifications[0]}
                                title={group().label}
                                subtitle={group().subtitle}
                                status={getGithubGroupStatus(group())}
                                url={getGithubGroupUrl(group())}
                                authorId={group().authorId}
                                authorFallback={group().authorFallback}
                              />
                            </div>
                          </Show>
                          <Show
                            when={group().kind === 'github'}
                            fallback={
                              <>
                                <Show
                                  when={
                                    group().subItems.length === 1
                                      ? group().subItems[0]
                                      : undefined
                                  }
                                >
                                  {(subItem) => (
                                    <NotificationListEntity
                                      notification={subItem().notification}
                                      collapsedCount={subItem().collapsedCount}
                                      collapsedNotifications={
                                        subItem().collapsedNotifications
                                      }
                                      stacked
                                    />
                                  )}
                                </Show>
                                <Show when={group().subItems.length > 1}>
                                  <div class="rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden divide-y divide-ink-muted/8">
                                    <For each={group().subItems}>
                                      {(item) => (
                                        <NotificationListEntity
                                          notification={item.notification}
                                          collapsedCount={item.collapsedCount}
                                          collapsedNotifications={
                                            item.collapsedNotifications
                                          }
                                          stacked
                                        />
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </>
                            }
                          >
                            <Show when={group().subItems.length > 0}>
                              <div class="rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden">
                                <div class="divide-y divide-ink-muted/8">
                                  <For each={group().subItems}>
                                    {(item) => (
                                      <GithubNotificationListEntity
                                        notification={item.notification}
                                      />
                                    )}
                                  </For>
                                </div>
                              </div>
                            </Show>
                          </Show>
                        </section>
                      )}
                    </Show>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
