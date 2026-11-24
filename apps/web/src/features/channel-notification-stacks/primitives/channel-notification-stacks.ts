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
  type ReadAt,
  retireDone,
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
  /** `notDone` holds every not-done notification, under the read's limit. */
  complete: Accessor<boolean>;
  /** When a notification was read; see `ReadAt`. */
  readAt: ReadAt;
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
  // Ids taken off the list, put back if marking them fails.
  const [taken, setTaken] = createSignal<readonly string[]>([]);
  const gathered = createMemo<ListedNotifications>((previous) => {
    const notDone = notDoneRecords();
    const admitted = admitUnread(
      previous,
      notDone,
      sources.settled(),
      sources.unreadSince,
      sources.readAt
    );
    // One missing from a complete answer was done, here or elsewhere, and
    // leaves for good; one being marked here waits for its mark's outcome.
    if (!sources.settled() || !sources.complete()) return admitted;
    return retireDone(admitted, notDone, taken());
  }, NO_LISTED_NOTIFICATIONS);

  const listed = createMemo<ChannelStack[]>((previous) => {
    const takenIds = new Set(taken());
    // Each entry shows its notifications' current state; past the read's
    // limit, its last known state.
    const current = new Map(notDoneRecords().map((n) => [n.id, n]));
    const shown = gathered().notifications.flatMap((notification) => {
      if (takenIds.has(notification.id)) return [];
      const now = current.get(notification.id);
      if (now) return [now];
      return notification.state === 'done' ? [] : [notification];
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
