import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { TOKENS } from '@core/hotkey/tokens';
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
import { Hotkey } from '@ui';
import { type Component, createMemo, createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';

function QuickLinkButton(props: {
  label: string;
  icon: Component<{ class?: string; triggerAnimation?: boolean }>;
  color?: 'agent' | 'document' | 'folder' | 'task';
  hotkey: string;
  standaloneHotkey?: boolean;
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
      class="group flex h-20 flex-col items-start justify-between rounded-2xl border border-edge-muted bg-hover/60 p-3 text-left transition hover:border-edge hover:bg-hover focus:outline-none focus-visible:border-accent"
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
        <ArrowRightIcon class="size-3.5 text-ink-extra-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
      <div class="flex w-full items-end justify-between gap-2">
        <span class="text-sm font-medium text-ink">{props.label}</span>
        <span class="flex items-center gap-1">
          {!props.standaloneHotkey && (
            <Hotkey token={TOKENS.sidebar.goToLeader} theme="subtle" />
          )}
          <Hotkey shortcut={props.hotkey} theme="subtle" />
        </span>
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
    <section>
      <div class="grid grid-cols-4 gap-2 xl:grid-cols-8">
        <QuickLinkButton
          label="Inbox"
          icon={AnimatedInboxIcon}
          hotkey="i"
          notificationCount={inboxNotificationCount()}
        />
        <QuickLinkButton
          label="Search"
          icon={AnimatedSearchIcon}
          hotkey="/"
          standaloneHotkey
        />
        <QuickLinkButton
          label="Agents"
          icon={AnimatedStarIcon}
          color="agent"
          hotkey="a"
        />
        <QuickLinkButton
          label="Email"
          icon={AnimatedEmailIcon}
          hotkey="e"
          notificationCount={emailNotificationCount()}
        />
        <QuickLinkButton
          label="Docs"
          icon={AnimatedFileMdIcon}
          color="document"
          hotkey="d"
        />
        <QuickLinkButton
          label="Tasks"
          icon={AnimatedTaskIcon}
          color="task"
          hotkey="t"
          notificationCount={taskNotificationCount()}
        />
        <QuickLinkButton
          label="Channels"
          icon={AnimatedChannelIcon}
          hotkey="c"
          notificationCount={channelNotificationCount()}
        />
        <QuickLinkButton
          label="Folders"
          icon={AnimatedFolderIcon}
          color="folder"
          hotkey="f"
        />
      </div>
    </section>
  );
}
