import ArrowRightIcon from '@phosphor/arrow-right.svg';
import ChatCircleTextIcon from '@phosphor/chat-circle-text.svg';
import CheckSquareIcon from '@phosphor/check-square.svg';
import EnvelopeSimpleIcon from '@phosphor/envelope-simple.svg';
import FileTextIcon from '@phosphor/file-text.svg';
import RobotIcon from '@phosphor/robot.svg';
import { notificationIsRead } from '@notifications/notification-helpers';
import type { UnifiedNotification } from '@notifications/types';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

const fallbackPriorities = [
  {
    title: 'Check unread mentions',
    source: 'Channels and comments',
    meta: 'Inbox',
    icon: ChatCircleTextIcon,
  },
  {
    title: 'Review assigned tasks',
    source: 'Tasks waiting on you',
    meta: 'Today',
    icon: CheckSquareIcon,
  },
  {
    title: 'Follow up on AI responses',
    source: 'Agent activity',
    meta: 'Recent',
    icon: RobotIcon,
  },
];

function entityLabel(type: string) {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function relativeTime(value?: string | null) {
  if (!value) return 'Recent';

  const then = new Date(value).getTime();
  const diff = Date.now() - then;
  const minutes = Math.max(1, Math.round(diff / 60000));

  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function notificationIcon(notification: UnifiedNotification) {
  const tag = notification.notification_metadata.tag;
  if (tag === 'ai_response') return RobotIcon;
  if (tag === 'new_email') return EnvelopeSimpleIcon;
  if (tag === 'task_assigned') return CheckSquareIcon;
  if (tag.includes('document')) return FileTextIcon;
  return ChatCircleTextIcon;
}

function notificationTitle(notification: UnifiedNotification) {
  const metadata = notification.notification_metadata as {
    content?: Record<string, unknown>;
  };
  const content = metadata.content ?? {};

  return (
    (content.taskName as string | undefined) ??
    (content.subject as string | undefined) ??
    (content.summary as string | undefined) ??
    (content.messageContent as string | undefined) ??
    (content.text as string | undefined) ??
    (content.documentName as string | undefined) ??
    (content.channelName as string | undefined) ??
    'New activity needs review'
  );
}

function notificationSource(notification: UnifiedNotification) {
  const metadata = notification.notification_metadata as {
    content?: Record<string, unknown>;
  };
  const content = metadata.content ?? {};

  return (
    (content.channelName as string | undefined) ??
    (content.documentName as string | undefined) ??
    (content.teamName as string | undefined) ??
    entityLabel(notification.entity_type)
  );
}

export function PrioritiesSection() {
  const notificationsQuery = useUserNotificationsQuery({ limit: 20 });

  const notifications = createMemo(() => notificationsQuery.data ?? []);
  const openNotifications = createMemo(() =>
    notifications()
      .filter((notification) => !notification.done)
      .sort((a, b) => {
        const unreadDelta =
          Number(notificationIsRead(a)) - Number(notificationIsRead(b));
        if (unreadDelta !== 0) return unreadDelta;
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      })
  );

  const priorityItems = createMemo(() =>
    openNotifications()
      .slice(0, 5)
      .map((notification) => ({
        title: notificationTitle(notification),
        source: notificationSource(notification),
        meta: relativeTime(notification.created_at),
        unread: !notificationIsRead(notification),
        icon: notificationIcon(notification),
      }))
  );

  const visiblePriorities = createMemo(() =>
    priorityItems().length > 0 ? priorityItems() : fallbackPriorities
  );

  const unreadCount = createMemo(
    () =>
      notifications().filter(
        (notification) => !notificationIsRead(notification)
      ).length
  );

  return (
    <section class="px-6 pb-8 sm:px-8">
      <div class="max-w-3xl">
        <div class="mb-4 flex items-end justify-between gap-4">
          <div>
            <p class="text-xs font-medium uppercase tracking-[0.18em] text-ink-extra-muted">
              Focus
            </p>
            <h2 class="mt-1 text-xl font-semibold tracking-tight text-ink">
              Priorities
            </h2>
          </div>
          <Button
            variant="ghost"
            size="md"
            class="hidden rounded-lg sm:inline-flex"
          >
            Open inbox
            <ArrowRightIcon />
          </Button>
        </div>

        <div class="overflow-hidden rounded-2xl border border-edge-muted">
          <div class="flex items-center justify-between gap-4 border-b border-edge-muted px-4 py-3">
            <div>
              <h3 class="font-semibold tracking-tight text-ink">Up next</h3>
              <p class="mt-0.5 text-sm text-ink-muted">
                Mentions, tasks, messages, and agent replies ordered by urgency.
              </p>
            </div>
            <div class="hidden rounded-full border border-edge-muted px-2.5 py-1 text-xs font-medium text-ink-muted sm:block">
              {unreadCount()} unread
            </div>
          </div>

          <div class="divide-y divide-edge-muted">
            <Show
              when={!notificationsQuery.isLoading}
              fallback={
                <For each={[0, 1, 2]}>
                  {() => (
                    <div class="flex items-center gap-3 px-4 py-3">
                      <div class="size-9 rounded-xl bg-ink/5" />
                      <div class="min-w-0 flex-1 space-y-2">
                        <div class="h-3 w-3/4 rounded bg-ink/5" />
                        <div class="h-2.5 w-1/2 rounded bg-ink/5" />
                      </div>
                    </div>
                  )}
                </For>
              }
            >
              <For each={visiblePriorities()}>
                {(priority) => (
                  <Button
                    variant="ghost"
                    size="md"
                    class="group h-auto w-full justify-start rounded-none border-0 px-4 py-3 text-left"
                  >
                    <span class="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink/5 text-ink-muted transition group-hover:bg-ink group-hover:text-surface [&_svg]:size-4">
                      <Dynamic component={priority.icon} />
                      <Show when={'unread' in priority && priority.unread}>
                        <span class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-accent" />
                      </Show>
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-ink">
                        {priority.title}
                      </span>
                      <span class="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                        <span class="truncate">{priority.source}</span>
                        <span class="size-1 rounded-full bg-ink-extra-muted" />
                        <span>{priority.meta}</span>
                      </span>
                    </span>
                    <ArrowRightIcon class="size-4 shrink-0 text-ink-extra-muted transition group-hover:translate-x-0.5 group-hover:text-ink" />
                  </Button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
}
