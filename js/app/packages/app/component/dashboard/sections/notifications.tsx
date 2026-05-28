import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { EntityIcon } from '@core/component/EntityIcon';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { UserIcon } from '@core/component/UserIcon';
import {
  createTheme,
  theme as markdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import { tryMacroId, useDisplayName } from '@core/user';
import { formatDate } from '@core/util/date';
import { Entity } from '@entity';
import {
  getNotificationContent,
  getNotificationTargetName,
  notificationIsRead,
  openNotification,
} from '@notifications';
import type { UnifiedNotification } from '@notifications/types';
import BellIcon from '@phosphor/bell.svg';
import { cn, Layer } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

const compactMarkdownTheme = createTheme(
  {
    paragraph: 'm-0 md-p text-[1em]',
    list: {
      listitem: 'm-0',
    },
  },
  markdownTheme
);

function metadataContent(notification: UnifiedNotification) {
  return (
    notification.notification_metadata as { content?: Record<string, unknown> }
  ).content;
}

function NotificationRow(props: { notification: UnifiedNotification }) {
  const notificationSource = useGlobalNotificationSource();
  const actorId = () => props.notification.sender_id ?? '';
  const macroId = () => tryMacroId(actorId());
  const [actorName] = useDisplayName(macroId());
  const actor = () => {
    const content = metadataContent(props.notification);
    return (
      actorName() ||
      (content?.senderName as string | undefined) ||
      (content?.fromName as string | undefined) ||
      (content?.from as string | undefined) ||
      (content?.senderEmail as string | undefined) ||
      'Someone'
    );
  };
  const unread = () => !notificationIsRead(props.notification);
  const target = () => getNotificationTargetName(props.notification);
  const notificationContent = () => metadataContent(props.notification);
  const channelName = () =>
    notificationContent()?.channelName as string | undefined;
  const isDirectMessage = () =>
    notificationContent()?.channelType === 'directMessage';
  const content = () => getNotificationContent(props.notification);
  const tag = () => props.notification.notification_metadata.tag;
  const title = () => {
    if (tag() === 'task_assigned') return target() || content() || 'Task';
    if (tag() === 'new_email' || isDirectMessage()) return actor();
    return channelName() || actor();
  };
  const description = () => {
    if (tag() === 'new_email') return content();
    if (tag() === 'task_assigned') return target() || content();
    return content();
  };

  const open = () => {
    const manager = globalSplitManager();
    if (!manager) return;
    void openNotification(props.notification, manager, false);
    if (unread()) void notificationSource.markAsRead(props.notification);
  };

  return (
    <button
      class="group relative w-full rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={open}
    >
      <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 pr-3">
        <div class="relative shrink-0">
          <Show
            when={isDirectMessage() && actorId()}
            fallback={
              <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover transition group-hover:bg-active">
                <Show
                  when={tag() === 'task_assigned'}
                  fallback={
                    <Entity.Notification.Icon
                      notification={props.notification as any}
                      class="shrink-0"
                    />
                  }
                >
                  <EntityIcon targetType="task" size="sm" class="shrink-0" />
                </Show>
              </div>
            }
          >
            {(id) => (
              <UserIcon id={id()} size="md" suppressClick showTooltip={false} />
            )}
          </Show>
          <Show when={unread()}>
            <span class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent" />
          </Show>
        </div>

        <div class="flex min-w-0 items-center gap-1.5">
          <p class="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[0.8125rem] font-semibold text-ink">
            <span class="truncate">{title()}</span>
          </p>
          <span class="shrink-0 text-xxs font-light text-ink-extra-muted">
            {formatDate(props.notification.created_at, { shortWeekday: true })}
          </span>
        </div>

        <Show
          when={tag() === 'task_assigned'}
          fallback={
            <Show when={description()}>
              {(markdown) => (
                <div class="col-start-2 flex min-w-0 items-start gap-1.5 text-xs/5 text-ink-muted [&_*]:text-xs [&_*]:leading-5">
                  <Show when={channelName() && !isDirectMessage() && actorId()}>
                    {(id) => (
                      <span class="inline-flex shrink-0 items-center gap-1 font-medium text-ink-muted">
                        <UserIcon
                          id={id()}
                          size="xs"
                          suppressClick
                          showTooltip={false}
                        />
                        <span>{actor()}</span>
                      </span>
                    )}
                  </Show>
                  <div class="line-clamp-2 min-w-0">
                    <StaticMarkdown
                      markdown={markdown()}
                      theme={compactMarkdownTheme}
                    />
                  </div>
                </div>
              )}
            </Show>
          }
        >
          <div class="col-start-2 flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
            <Show when={actorId()}>
              {(id) => (
                <UserIcon
                  id={id()}
                  size="xs"
                  suppressClick
                  showTooltip={false}
                />
              )}
            </Show>
            <span class="truncate">
              <span class="font-medium">{actor()}</span> assigned you
            </span>
          </div>
        </Show>
      </div>
    </button>
  );
}

export function DashboardNotificationList(props: {
  notifications: UnifiedNotification[];
  class?: string;
}) {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();

  return (
    <div class="relative min-h-0 overflow-hidden">
      <div
        ref={setScrollContainer}
        class={cn('scrollbar-hidden overflow-y-auto pr-2', props.class)}
      >
        <div class="flex flex-col">
          <For each={props.notifications}>
            {(notification) => (
              <NotificationRow notification={notification} />
            )}
          </For>
        </div>
      </div>
      <CustomScrollbar
        scrollContainer={scrollContainer}
        labelVisibilityDebounceMs={Infinity}
        class="right-0.5"
      />
    </div>
  );
}

export function NotificationsSection() {
  const notificationSource = useGlobalNotificationSource();

  const notifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter(
        (notification) =>
          !notification.done && !notificationIsRead(notification)
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
  );

  return (
    <section>
      <Layer depth={2}>
        <div class="overflow-hidden rounded-2xl border border-edge-muted bg-surface">
          <div class="flex items-center gap-2 p-3">
            <h2 class="text-lg font-semibold tracking-tight text-ink">
              Notifications
            </h2>
            <Show when={notifications().length > 0}>
              <span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-hover px-1.5 text-xxs font-semibold tabular-nums text-ink-muted">
                {notifications().length}
              </span>
            </Show>
          </div>

          <div class="px-3 pb-3">
            <Show
              when={!notificationSource.isLoading()}
              fallback={
                <For each={[0, 1, 2]}>
                  {() => (
                    <div class="flex h-16 items-center gap-3 rounded-xl px-3">
                      <div class="skeleton-shimmer size-6 rounded-full bg-hover" />
                      <div class="min-w-0 flex-1 space-y-2">
                        <div class="skeleton-shimmer h-2.5 w-4/5 rounded-full bg-ink/10" />
                        <div class="skeleton-shimmer h-2 w-1/2 rounded-full bg-ink/5" />
                      </div>
                    </div>
                  )}
                </For>
              }
            >
              <Show
                when={notifications().length > 0}
                fallback={
                  <div class="flex flex-col items-center justify-center px-4 py-8 text-center">
                    <div class="mb-3 flex size-10 items-center justify-center rounded-xl bg-hover text-ink-muted">
                      <BellIcon class="size-5" />
                    </div>
                    <p class="text-sm font-medium text-ink">
                      You're all caught up
                    </p>
                    <p class="mt-1 text-xs text-ink-muted">
                      New mentions, tasks, and replies will appear here.
                    </p>
                  </div>
                }
              >
                <DashboardNotificationList
                  notifications={notifications()}
                  class="max-h-80"
                />
              </Show>
            </Show>
          </div>
        </div>
      </Layer>
    </section>
  );
}
