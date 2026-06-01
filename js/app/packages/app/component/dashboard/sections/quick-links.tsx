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
import { cn, Layer } from '@ui';
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
        return 'bg-chat/10 text-chat border-chat/15';
      case 'document':
        return 'bg-note/10 text-note border-note/15';
      case 'folder':
        return 'bg-folder/10 text-folder border-folder/15';
      case 'task':
        return 'bg-task/10 text-task border-task/15';
      default:
        return 'text-ink-muted group-hover:text-ink';
    }
  };

  return (
    <button
      class={cn(
        'group relative flex flex-col items-start justify-between rounded-md border border-edge-muted bg-hover/60 px-2 py-1 text-left transition hover:border-edge hover:bg-hover focus:outline-none focus-visible:border-accent',
        colorClass()
      )}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      <div class="flex w-full items-center justify-between gap-2">
        <div class="relative">
          <Dynamic
            component={props.icon}
            class="size-3 transition"
            triggerAnimation={hovering()}
          />
          {(props.notificationCount ?? 0) > 0 && (
            <span class="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-hover bg-accent" />
          )}
        </div>

        <span class="min-w-0 text-xs font-medium">{props.label}</span>
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
    <section class="@container/quick-links w-full flex items-center justify-center">
      <div class="flex items-center gap-2">
        <QuickLinkButton label="Agents" icon={AnimatedStarIcon} color="agent" />
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
          label="Folders"
          icon={AnimatedFolderIcon}
          color="folder"
        />
      </div>
    </section>
  );
}
