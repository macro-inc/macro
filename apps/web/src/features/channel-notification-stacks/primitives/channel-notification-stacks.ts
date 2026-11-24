import type { UnifiedNotification } from '@notifications/types';
import { type Accessor, createMemo, createSignal, untrack } from 'solid-js';
import {
  admitUnread,
  type ChannelStack,
  channelStacks,
  keepUnchangedStacks,
  type ListedNotifications,
  NO_LISTED_NOTIFICATIONS,
  notificationsToMarkDone,
} from '../core/channel-stacks';

/**
 * A channel's notification stacks for the gutter. `listed` holds what was
 * unread when the channel opened, plus thread replies and mentions that arrive
 * unread while it is open; reading never removes an entry, and only marking
 * it done does. Marking an entry marks its whole inbox stack, from the
 * channel's not-done notifications.
 *
 * Create it as the channel mounts: what is unread at the first answer must be
 * caught before the channel marks the messages on screen read.
 */
export function createChannelNotificationStacks(sources: {
  /** The channel's unread notifications, with local marks applied. */
  unread: Accessor<readonly UnifiedNotification[]>;
  /** The unread read has answered from the server, not only from cache. */
  unreadSettled: Accessor<boolean>;
  /** Not-done notifications; undefined until they load. */
  active: Accessor<readonly UnifiedNotification[] | undefined>;
  /** Mark notifications done; resolves false when that failed. */
  markDone: (
    stacks: readonly ChannelStack[],
    notifications: UnifiedNotification[]
  ) => Promise<boolean>;
}) {
  const gathered = createMemo<ListedNotifications>(
    (previous) =>
      admitUnread(previous, sources.unread(), sources.unreadSettled()),
    NO_LISTED_NOTIFICATIONS
  );
  // Ids taken off the list, put back if marking them fails.
  const [taken, setTaken] = createSignal<readonly string[]>([]);

  const listed = createMemo<ChannelStack[]>((previous) => {
    const takenIds = new Set(taken());
    // The unread read holds only what is still unread, so a listed
    // notification missing from it has been read, here or elsewhere.
    const stillUnread = new Set(
      sources
        .unread()
        .filter((notification) => notification.state === 'unseen')
        .map((notification) => notification.id)
    );
    const shown = gathered()
      .notifications.filter(
        (notification) =>
          !takenIds.has(notification.id) && notification.state !== 'done'
      )
      .map((notification) =>
        notification.state === 'unseen' && !stillUnread.has(notification.id)
          ? { ...notification, state: 'seen' as const }
          : notification
      );
    return keepUnchangedStacks(previous, channelStacks(shown));
  }, []);
  const notDone = createMemo(() =>
    channelStacks(
      (sources.active() ?? []).filter(
        (notification) => notification.state !== 'done'
      )
    )
  );

  /** Take stacks off the list; the returned function puts them back. */
  const take = (stacks: readonly ChannelStack[]) => {
    const ids = stacks.flatMap((stack) =>
      stack.notifications.map((notification) => notification.id)
    );
    setTaken((current) => [...current, ...ids]);
    return () => {
      const restored = new Set(ids);
      setTaken((current) => current.filter((id) => !restored.has(id)));
    };
  };

  return {
    listed,
    /** Take stacks off the list at once and mark them done; a failed mark puts them back. */
    markDone: async (stacks: readonly ChannelStack[]) => {
      if (stacks.length === 0) return;
      const notifications = notificationsToMarkDone(stacks, untrack(notDone));
      const putBack = take(stacks);
      if (!(await sources.markDone(stacks, notifications))) putBack();
    },
  };
}
