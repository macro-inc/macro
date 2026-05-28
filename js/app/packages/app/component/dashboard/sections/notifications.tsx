import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  createTheme,
  theme as markdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import { tryMacroId, useDisplayName } from '@core/user';
import { formatDate } from '@core/util/date';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  notificationIsRead,
  openNotification,
} from '@notifications';
import type { UnifiedNotification } from '@notifications/types';
import BellIcon from '@phosphor/bell.svg';
import ChatCircleTextIcon from '@phosphor/chat-circle-text.svg';
import CheckSquareIcon from '@phosphor/check-square.svg';
import EnvelopeSimpleIcon from '@phosphor/envelope-simple.svg';
import FileTextIcon from '@phosphor/file-text.svg';
import RobotIcon from '@phosphor/robot.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { Layer } from '@ui';
import { Dynamic } from 'solid-js/web';
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

function actorLabel(notification: UnifiedNotification) {
  const actorId = () => notification.sender_id ?? '';
  const macroId = () => tryMacroId(actorId());
  const [name] = useDisplayName(macroId());
  return () => name() || 'Someone';
}

function notificationIcon(notification: UnifiedNotification) {
  const tag = notification.notification_metadata.tag;
  if (tag === 'ai_response') return RobotIcon;
  if (tag === 'new_email') return EnvelopeSimpleIcon;
  if (tag === 'task_assigned') return CheckSquareIcon;
  if (tag === 'channel_invite' || tag === 'invite_to_team') return UsersThreeIcon;
  if (tag.includes('document')) return FileTextIcon;
  if (tag.startsWith('channel_')) return ChatCircleTextIcon;
  return BellIcon;
}

function NotificationRow(props: { notification: UnifiedNotification }) {
  const notificationSource = useGlobalNotificationSource();
  const actor = actorLabel(props.notification);
  const content = () => getNotificationContent(props.notification);
  const target = () => getNotificationTargetName(props.notification);
  const unread = () => !notificationIsRead(props.notification);

  const open = (event: MouseEvent) => {
    const manager = globalSplitManager();
    if (!manager) return;
    void openNotification(props.notification, manager, event.shiftKey);
    if (unread()) void notificationSource.markAsRead(props.notification);
  };

  return (
    <button
      class="group relative flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={open}
    >
      <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-muted transition group-hover:text-ink [&_svg]:size-4">
        <Dynamic component={notificationIcon(props.notification)} />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-1.5 text-xs">
          <span class="truncate font-semibold text-ink">{actor()}</span>
          <Show when={target()}>
            {(name) => (
              <span class="truncate font-medium text-ink">{name()}</span>
            )}
          </Show>
        </div>
        <div class="flex items-center gap-1.5 text-xxs text-ink-extra-muted">
          <span>{getNotificationAction(props.notification)}</span>
          <span class="size-1 rounded-full bg-ink-extra-muted/60" />
          <span>
            {formatDate(props.notification.created_at, { shortWeekday: true })}
          </span>
        </div>
        <Show when={content()}>
          {(markdown) => (
            <div class="mt-1 line-clamp-2 text-xs/5 text-ink-muted [&_*]:text-xs [&_*]:leading-5">
              <StaticMarkdown
                markdown={markdown()}
                theme={compactMarkdownTheme}
              />
            </div>
          )}
        </Show>
      </div>
      <Show when={unread()}>
        <span class="mt-1 size-2 shrink-0 rounded-full bg-accent" />
      </Show>
    </button>
  );
}

export function NotificationsSection() {
  const notificationSource = useGlobalNotificationSource();
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();

  const notifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter((notification) => !notification.done)
      .sort(
        (a, b) =>
          Number(!notificationIsRead(b)) - Number(!notificationIsRead(a)) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .slice(0, 4)
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

          <div class="relative">
            <div
              ref={setScrollContainer}
              class="max-h-80 overflow-y-auto px-3 pb-3"
            >
              <div class="space-y-1">
        <Show
          when={!notificationSource.isLoading()}
          fallback={
            <For each={[0, 1, 2]}>
              {() => (
                <div class="flex h-16 items-center gap-3 rounded-xl px-3">
                  <div class="size-6 rounded-full bg-hover" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-2.5 w-4/5 rounded-full bg-ink/10" />
                    <div class="h-2 w-1/2 rounded-full bg-ink/5" />
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
                <p class="text-sm font-medium text-ink">You're all caught up</p>
                <p class="mt-1 text-xs text-ink-muted">
                  New mentions, tasks, and replies will appear here.
                </p>
              </div>
            }
          >
            <For each={notifications()}>
              {(notification) => <NotificationRow notification={notification} />}
            </For>
          </Show>
        </Show>
              </div>
            </div>
            <CustomScrollbar
              scrollContainer={scrollContainer}
              labelVisibilityDebounceMs={Infinity}
              class="right-0.5"
            />
          </div>
        </div>
      </Layer>
    </section>
  );
}
