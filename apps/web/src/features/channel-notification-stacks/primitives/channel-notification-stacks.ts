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
 * while it is open; reading never removes an entry, and only marking it done
 * does. Marking an entry marks its whole inbox stack.
 */
export function createChannelNotificationStacks(sources: {
  /** The channel's not-done notifications; undefined until they load. */
  notDone: Accessor<readonly UnifiedNotification[] | undefined>;
  /** `notDone` came from the server, not only from cache. */
  settled: Accessor<boolean>;
  /** Reads at or after this time (epoch ms) count as unread at open. */
  unreadSince: number;
  /** Mark notifications done; resolves false when that failed. */
  markDone: (
    stacks: readonly ChannelStack[],
    notifications: UnifiedNotification[]
  ) => Promise<boolean>;
}) {
  const notDoneRecords = () =>
    (sources.notDone() ?? []).filter(
      (notification) => notification.state !== 'done'
    );
  const gathered = createMemo<ListedNotifications>(
    (previous) =>
      admitUnread(
        previous,
        notDoneRecords(),
        sources.settled(),
        sources.unreadSince
      ),
    NO_LISTED_NOTIFICATIONS
  );
  // Ids taken off the list, put back if marking them fails.
  const [taken, setTaken] = createSignal<readonly string[]>([]);

  const listed = createMemo<ChannelStack[]>((previous) => {
    const takenIds = new Set(taken());
    // Each entry shows its notifications' current state; one no longer in
    // the read was done or read elsewhere, and is shown read.
    const current = new Map(notDoneRecords().map((n) => [n.id, n]));
    const shown = gathered()
      .notifications.filter(
        (notification) =>
          !takenIds.has(notification.id) && notification.state !== 'done'
      )
      .map((notification) => {
        const now = current.get(notification.id);
        if (now) return now;
        return notification.state === 'unseen'
          ? { ...notification, state: 'seen' as const }
          : notification;
      });
    return keepUnchangedStacks(previous, channelStacks(shown));
  }, []);
  const notDone = createMemo(() => channelStacks(notDoneRecords()));

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
    /**
     * Take stacks off the list at once and mark them done; a failed mark puts
     * them back.
     */
    markDone: async (stacks: readonly ChannelStack[]) => {
      if (stacks.length === 0) return;
      const notifications = notificationsToMarkDone(stacks, untrack(notDone));
      const putBack = take(stacks);
      if (!(await sources.markDone(stacks, notifications))) putBack();
    },
  };
}
