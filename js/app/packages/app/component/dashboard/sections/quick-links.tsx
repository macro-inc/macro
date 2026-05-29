import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedFolderIcon } from '@icon/wide-folder';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import { notificationIsRead } from '@notifications/notification-helpers';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { Layer } from '@ui';
import { type Component, createMemo, createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';

function QuickLinkButton(props: {
  label: string;
  icon: Component<{ class?: string; triggerAnimation?: boolean }>;
  color?: 'agent' | 'document' | 'folder' | 'task';
  notificationCount?: number;
}) {
  const [hovering, setHovering] = createSignal(false);
  const colorClass = () => {
    switch (props.color) {
      case 'agent':
        return 'text-chat';
      case 'document':
        return 'text-note';
      case 'folder':
        return 'text-folder';
      case 'task':
        return 'text-task';
      default:
        return 'text-ink-muted group-hover:text-ink';
    }
  };

  return (
    <button
      class="group relative flex h-20 flex-col items-start justify-between rounded-2xl border border-edge-muted bg-hover/60 p-3 text-left transition hover:border-edge hover:bg-hover focus:outline-none focus-visible:border-accent"
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      <div class="flex w-full items-start justify-between gap-2">
        <div class="relative">
          <Dynamic
            component={props.icon}
            class={`size-5 transition ${colorClass()}`}
            triggerAnimation={hovering()}
          />
          {(props.notificationCount ?? 0) > 0 && (
            <span class="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-hover bg-accent" />
          )}
        </div>

      </div>
      <div class="flex w-full min-w-0 items-end justify-between gap-2">
        <span class="min-w-0 truncate text-sm font-medium text-ink">
          {props.label}
        </span>
        <div class="pointer-events-none absolute right-3 top-3 opacity-0 transition group-hover:opacity-100">
          <Layer depth={3} class="rounded-xl">
            <div class="flex size-8 items-center justify-center rounded-xl bg-hover text-ink-muted transition group-hover:text-ink">
              <ArrowRightIcon class="size-4" />
            </div>
          </Layer>
        </div>
      </div>
    </button>
  );
}

export function QuickLinksSection() {
  const notificationSource = useGlobalNotificationSource();

  const unreadNotifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter(
        (notification) =>
          !notification.done && !notificationIsRead(notification)
      )
  );

  const unreadCountFor = (predicate: (entityType: string) => boolean) =>
    createMemo(
      () =>
        unreadNotifications().filter((notification) =>
          predicate(notification.entity_type)
        ).length
    );

  const inboxNotificationCount = createMemo(() => unreadNotifications().length);

  const emailNotificationCount = unreadCountFor(
    (entityType) => entityType === 'email' || entityType === 'email_thread'
  );

  const taskNotificationCount = createMemo(
    () =>
      unreadNotifications().filter(
        (notification) =>
          notification.notification_metadata.tag === 'task_assigned'
      ).length
  );

  const channelNotificationCount = unreadCountFor(
    (entityType) => entityType === 'channel'
  );

  return (
    <section class="@container/quick-links">
      <div class="grid grid-cols-2 gap-2 @md/quick-links:grid-cols-4 @4xl/quick-links:grid-cols-8">
        <QuickLinkButton
          label="Inbox"
          icon={AnimatedInboxIcon}
          notificationCount={inboxNotificationCount()}
        />
        <QuickLinkButton
          label="Search"
          icon={AnimatedSearchIcon}
        />
        <QuickLinkButton
          label="Agents"
          icon={AnimatedStarIcon}
          color="agent"
        />
        <QuickLinkButton
          label="Email"
          icon={AnimatedEmailIcon}
          notificationCount={emailNotificationCount()}
        />
        <QuickLinkButton
          label="Docs"
          icon={AnimatedFileMdIcon}
          color="document"
        />
        <QuickLinkButton
          label="Tasks"
          icon={AnimatedTaskIcon}
          color="task"
          notificationCount={taskNotificationCount()}
        />
        <QuickLinkButton
          label="Channels"
          icon={AnimatedChannelIcon}
          notificationCount={channelNotificationCount()}
        />
        <QuickLinkButton
          label="Folders"
          icon={AnimatedFolderIcon}
          color="folder"
        />
      </div>
    </section>
  );
}
