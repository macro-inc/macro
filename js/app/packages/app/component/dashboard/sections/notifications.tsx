import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { EntityRow, EntityRowProvider } from '@app/component/mobile/EntityRow';
import { globalSplitManager } from '@app/signal/splitLayout';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { EntityIcon } from '@core/component/EntityIcon';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  createTheme,
  theme as markdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { Entity } from '@entity';
import {
  getNotificationContent,
  getNotificationTargetName,
  notificationIsRead,
  openNotification,
} from '@notifications';
import { isChannelNotification } from '@notifications/notification-helpers';
import type { UnifiedNotification } from '@notifications/types';
import BellIcon from '@phosphor/bell.svg';
import CheckIcon from '@phosphor/check.svg';
import { Button, cn, Layer, Tooltip } from '@ui';
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

function NotificationRow(props: { notification: UnifiedNotification }) {
  const notificationSource = useGlobalNotificationSource();

  const actorId = createMemo(() => props.notification.sender_id ?? '');
  const macroId = tryMacroId(actorId());
  const [actorName] = useDisplayName(macroId);

  const tag = createMemo(() => props.notification.notification_metadata.tag);
  const unread = createMemo(() => !notificationIsRead(props.notification));

  const target = createMemo(() =>
    getNotificationTargetName(props.notification)
  );
  const content = createMemo(() => getNotificationContent(props.notification));

  const channel = createMemo(() => {
    if (!isChannelNotification(props.notification)) return;
    return props.notification.notification_metadata.content;
  });

  const sender = createMemo(() => {
    const metadata = props.notification.notification_metadata;
    if (metadata.tag !== 'new_email') return;
    return metadata.content.sender;
  });

  const channelName = createMemo(() => channel()?.channelName);
  const isDirectMessage = createMemo(
    () => channel()?.channelType === 'directMessage'
  );

  const actor = createMemo(() => actorName() || sender() || 'Someone');

  const title = createMemo(() => {
    if (tag() === 'task_assigned') return target() || content() || 'Task';
    if (tag() === 'new_email' || isDirectMessage()) return actor();
    return channelName() || actor();
  });

  const description = createMemo(() => {
    if (tag() === 'new_email') return content();
    if (tag() === 'task_assigned') return target() || content();
    return content();
  });

  const open = () => {
    const manager = globalSplitManager();
    if (!manager) return;

    void openNotification(props.notification, manager, false);
    if (unread()) void notificationSource.markAsRead(props.notification);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    event.preventDefault();
    open();
  };

  const markDone = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void notificationSource.markAsDone(props.notification);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      class="group relative w-full rounded-lg py-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset sm:p-2.5"
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <div class="hidden absolute right-2 top-2 z-10 opacity-0 transition sm:block sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <Tooltip label="Mark done">
          <Button
            type="button"
            variant="base"
            size="icon-sm"
            depth={4}
            class="rounded-md bg-surface shadow-sm"
            aria-label="Mark notification done"
            onClick={markDone}
          >
            <CheckIcon class="size-2.5" />
          </Button>
        </Tooltip>
      </div>

      <div class="flex items-start gap-2">
        <div class="relative shrink-0">
          <Show
            when={isDirectMessage() && actorId()}
            fallback={
              <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover transition touch:size-9 group-hover:bg-active">
                <Show
                  when={tag() === 'task_assigned'}
                  fallback={
                    <Entity.Notification.Icon
                      notification={props.notification}
                      class="size-4 shrink-0 touch:size-5"
                    />
                  }
                >
                  <EntityIcon targetType="task" size="sm" class="shrink-0 touch:size-5" />
                </Show>
              </div>
            }
          >
            {(id) => (
              <UserIcon id={id()} size="md" class="touch:size-9" suppressClick showTooltip={false} />
            )}
          </Show>
          <Show when={unread()}>
            <span class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent" />
          </Show>
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 items-center gap-1.5">
            <p class="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[0.8125rem] font-semibold text-ink">
              <span class="truncate">{title()}</span>
            </p>
            <span class="shrink-0 text-xxs font-light text-ink-extra-muted">
              <Entity.Notification.Timestamp notification={props.notification} />
            </span>
          </div>

          <Show
            when={tag() === 'task_assigned'}
            fallback={
              <Show when={description()}>
                {(markdown) => (
                  <div class="flex min-w-0 items-start gap-1.5 text-xs/5 text-ink-muted [&_*]:text-xs [&_*]:leading-5">
                    <Show when={channelName() && !isDirectMessage() && actorId()}>
                      {(id) => (
                        <span class="inline-flex shrink-0 items-center gap-1 font-medium text-ink-muted">
                          <UserIcon
                            id={id()}
                            size="sm"
                            suppressClick
                            showTooltip={false}
                          />
                          <span>
                            <Entity.Notification.Sender
                              notification={props.notification}
                            />
                          </span>
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
            <div class="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
              <Show when={actorId()}>
                {(id) => (
                  <UserIcon
                    id={id()}
                    size="sm"
                    suppressClick
                    showTooltip={false}
                  />
                )}
              </Show>
              <span class="truncate">
                <span class="font-medium">
                  <Entity.Notification.Sender notification={props.notification} />
                </span>{' '}
                assigned you
              </span>
            </div>
          </Show>
        </div>

      </div>

    </div>
  );
}

export function DashboardNotificationList(props: {
  notifications: UnifiedNotification[];
  class?: string;
}) {
  const notificationSource = useGlobalNotificationSource();
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();

  return (
    <div class="relative min-h-0 overflow-hidden">
      <div
        ref={setScrollContainer}
        data-corvu-no-drag
        class={cn('scrollbar-hidden overflow-y-auto sm:pr-2', props.class)}
      >
        <StaticMarkdownContext>
          <div class="flex flex-col gap-1 sm:gap-0">
            <EntityRowProvider container={scrollContainer}>
            <For each={props.notifications}>
              {(notification) => (
                <EntityRow
                  entityId={notification.id}
                  swipeLeftColor="bg-success-bg"
                  swipeLeftRevealedComponent={
                    <CheckIcon class="size-5 text-success" />
                  }
                  onSwipeLeft={() =>
                    void notificationSource.markAsDone(notification)
                  }
                >
                  <NotificationRow notification={notification} />
                </EntityRow>
              )}
            </For>
            </EntityRowProvider>
          </div>
        </StaticMarkdownContext>
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
