import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { formatRelativeTimestamp } from '@entity';
import GithubIcon from '@icon/mcp-github.svg';
import ChannelIcon from '@icon/wide-channel.svg';
import EmailIcon from '@icon/wide-email.svg';
import type { UnifiedNotification } from '@notifications';
import FilesIcon from '@phosphor/files.svg';
import FunnelIcon from '@phosphor/funnel.svg';
import SortAscendingIcon from '@phosphor/sort-ascending.svg';
import StackIcon from '@phosphor/stack.svg';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import GitMergeIcon from '@phosphor-icons/core/regular/git-merge.svg?component-solid';
import GitPullRequestIcon from '@phosphor-icons/core/regular/git-pull-request.svg?component-solid';
import XCircleIcon from '@phosphor-icons/core/regular/x-circle.svg?component-solid';
import type { GithubPrEventStatus } from '@service-notification/generated/schemas';
import { Avatar, Button, cn, Tooltip } from '@ui';
import { createEffect, createMemo, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { NotificationListEntity } from './NotificationListEntity';

const getNotificationTime = (notification: UnifiedNotification): number => {
  const time = Date.parse(
    notification.created_at ?? notification.updated_at ?? ''
  );
  return Number.isNaN(time) ? 0 : time;
};

type NotificationVisualGroup = {
  id: string;
  label: string;
  subItems: UnifiedNotification[];
  subtitle?: string;
  authorId?: string;
  authorFallback?: string;
  icon: (props: { class?: string }) => JSX.Element;
  kind: 'default' | 'github';
  notifications: UnifiedNotification[];
};

const getChannelSenderLabel = (notification: UnifiedNotification): string => {
  const metadata = notification.notification_metadata;
  if (metadata.tag === 'channel_message_send') return metadata.content.sender;
  return notification.sender_id ?? 'Unknown sender';
};

const getNotificationRoot = (
  notification: UnifiedNotification
): Omit<NotificationVisualGroup, 'notifications'> => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply': {
      const isDirectMessage = metadata.content.channelType === 'directMessage';
      const sender = getChannelSenderLabel(notification);
      return {
        id: isDirectMessage
          ? `channel:${notification.entity_id}:sender:${sender}`
          : `channel:${notification.entity_id}`,
        label: isDirectMessage
          ? sender
          : (metadata.content.channelName ?? 'Channel'),
        subItems: [],
        subtitle: isDirectMessage ? 'Direct message' : 'Channel',
        icon: ChannelIcon,
        kind: 'default',
      };
    }
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
        id: `email:${metadata.content.threadId || notification.entity_id}`,
        label: metadata.content.subject,
        subItems: [],
        subtitle: 'Email thread',
        icon: EmailIcon,
        kind: 'default',
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
        icon: FilesIcon,
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
        icon: ChannelIcon,
        kind: 'default',
      };
  }
};

const getGithubStatusIcon = (status: GithubPrEventStatus) => {
  switch (status) {
    case 'open':
      return GitPullRequestIcon;
    case 'closed':
      return XCircleIcon;
    case 'merged':
      return GitMergeIcon;
  }
};

const getGithubStatusClass = (status: GithubPrEventStatus): string => {
  switch (status) {
    case 'open':
      return 'text-success';
    case 'closed':
      return 'text-failure';
    case 'merged':
      return 'text-note';
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

const getGithubUpdateText = (notification: UnifiedNotification): string => {
  const metadata = notification.notification_metadata;
  if (metadata.tag !== 'github_pr_event') return '';
  return metadata.content.action;
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

const getVisibleGroupNotifications = (
  group: NotificationVisualGroup
): UnifiedNotification[] => {
  if (group.kind !== 'github') return group.notifications;
  return group.notifications.filter(
    (notification) => !isGithubStatusNotification(notification)
  );
};

const getInitials = (value: string): string => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0]?.[0] ?? '?').toUpperCase();
};

function GithubAuthor(props: { id?: string; fallback?: string }) {
  const macroId = () => (props.id ? tryMacroId(props.id) : undefined);
  const [displayName] = useDisplayName(macroId());
  const label = () => displayName() || props.fallback || props.id || 'Unknown';

  return (
    <span class="shrink-0 flex items-center gap-1 text-ink-muted font-medium min-w-0">
      <Show
        when={macroId() && props.id}
        fallback={
          <Avatar size="sm" class="size-4">
            <Avatar.Fallback class="font-semibold">
              {getInitials(label())}
            </Avatar.Fallback>
          </Avatar>
        }
      >
        {(id) => (
          <UserIcon id={id()} size="sm" suppressClick showTooltip={false} />
        )}
      </Show>
      <span class="truncate max-w-28">{label()}</span>
    </span>
  );
}

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

function GithubNotificationItem(props: { notification: UnifiedNotification }) {
  const metadata = () => props.notification.notification_metadata;
  const github = () => {
    const value = metadata();
    return value.tag === 'github_pr_event' ? value.content : undefined;
  };
  const unread = () =>
    !props.notification.viewed_at && !props.notification.done;
  const timestamp = () =>
    formatRelativeTimestamp(
      props.notification.created_at ??
        props.notification.updated_at ??
        new Date(0),
      { condensed: true }
    );

  return (
    <Show
      when={github()}
      fallback={
        <NotificationListEntity notification={props.notification} stacked />
      }
    >
      {(content) => (
        <div class="group/notif flex items-center gap-2.5 px-3 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden">
          <span
            class={cn('size-1.5 rounded-full shrink-0', {
              'bg-accent': unread(),
              'bg-transparent': !unread(),
            })}
          />
          <div class="min-w-0 flex-1 flex items-center gap-2">
            <span
              class={cn('truncate min-w-0 text-xs text-ink', {
                'font-medium': unread(),
              })}
            >
              {getGithubUpdateText(props.notification)}
            </span>
            <span class="truncate min-w-0 text-xs text-ink-muted/60">
              {content().displayName}
            </span>
          </div>
          <span class="shrink-0 text-ink-extra-muted text-xs tabular-nums">
            {timestamp()}
          </span>
        </div>
      )}
    </Show>
  );
}

const groupNotifications = (
  notifications: UnifiedNotification[]
): NotificationVisualGroup[] => {
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

    let subItems = sorted;

    if (root.kind === 'github') {
      subItems = sorted.filter(
        (notification) => !isGithubStatusNotification(notification)
      );
    }

    return {
      ...root,
      subItems,
      notifications: sorted,
    };
  }).toSorted(
    (a, b) =>
      getNotificationTime(b.notifications[0]) -
      getNotificationTime(a.notifications[0])
  );
};

export function NotificationInbox2() {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();

  createEffect(() => {
    panel.handle.setDisplayName('Inbox 2');
  });

  const notifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter((notification) => !notification.deleted_at)
  );

  const notificationGroups = createMemo(() =>
    groupNotifications(notifications())
  );

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
              when={notificationGroups().length > 0}
              fallback={
                <div class="flex size-full items-center justify-center text-sm text-ink-muted">
                  No notifications
                </div>
              }
            >
              <div class="unified-table-body w-full flex flex-col gap-1 flex-1 min-h-0 relative overflow-y-auto p-2">
                <For each={notificationGroups()}>
                  {(group) => (
                    <section class="flex flex-col gap-1">
                      <div
                        class={cn(
                          'group/header rounded-lg px-2 py-2 flex items-center gap-2.5 text-xs font-semibold tracking-tight text-ink-muted bg-surface hover:ring hover:ring-inset hover:ring-edge border border-edge-muted relative',
                          {
                            'border-none': !group.subItems.length,
                          }
                        )}
                      >
                        <Show when={group.kind !== 'github'}>
                          <div class="shrink-0 rounded-xs bg-ink-muted/6 flex items-center justify-center text-ink-muted">
                            <Dynamic component={group.icon} class="size-3.5" />
                          </div>
                        </Show>
                        <div class="min-w-0 flex-1 flex items-center gap-1.5">
                          <Show when={getGithubGroupStatus(group)}>
                            {(status) => (
                              <Tooltip label={status()}>
                                <span
                                  class={cn(
                                    'shrink-0 flex items-center gap-1 text-xs font-medium capitalize',
                                    getGithubStatusClass(status())
                                  )}
                                >
                                  <Dynamic
                                    component={getGithubStatusIcon(status())}
                                    class="size-3.5"
                                  />
                                </span>
                              </Tooltip>
                            )}
                          </Show>
                          <span class="truncate text-ink-muted">
                            {group.label}
                          </span>
                          <Show when={group.authorId || group.authorFallback}>
                            <GithubAuthor
                              id={group.authorId}
                              fallback={group.authorFallback}
                            />
                          </Show>
                        </div>
                        <Show when={group.kind === 'github'}>
                          <div class="ml-auto shrink-0 h-5 flex items-center">
                            <Show
                              when={getGithubGroupUrl(group)}
                              fallback={
                                <p class="flex items-center gap-2">
                                  <GithubIcon class="size-3.5" />
                                  <Show when={group.subtitle}>
                                    {(subtitle) => (
                                      <span class="truncate text-ink-extra-muted">
                                        {subtitle()}
                                      </span>
                                    )}
                                  </Show>
                                </p>
                              }
                            >
                              {(url) => (
                                <a
                                  class="flex items-center gap-2 hover:underline"
                                  href={url()}
                                >
                                  <GithubIcon class="size-3.5" />
                                  <Show when={group.subtitle}>
                                    {(subtitle) => (
                                      <span class="truncate text-ink-extra-muted">
                                        {subtitle()}
                                      </span>
                                    )}
                                  </Show>
                                </a>
                              )}
                            </Show>
                          </div>
                        </Show>
                      </div>
                      <Show when={group.subItems.length}>
                        <div class="rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden">
                          <div class="divide-y divide-ink-muted/8">
                            <For each={getVisibleGroupNotifications(group)}>
                              {(notification) => (
                                <Show
                                  when={group.kind === 'github'}
                                  fallback={
                                    <NotificationListEntity
                                      notification={notification}
                                      stacked
                                    />
                                  }
                                >
                                  <GithubNotificationItem
                                    notification={notification}
                                  />
                                </Show>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </section>
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
