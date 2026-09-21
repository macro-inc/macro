import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import {
  reminderAlertIdentity,
  reminderAlertsFromNotifications,
} from './reminder-alerts';

export type AlertNotificationSource = Pick<
  NotificationSource,
  'notifications' | 'isLoading' | 'subscribe' | 'withLocalOverrides'
>;

/** New deliveries must alert even if their entity is outside loaded Soup pages. */
export function createReminderAlertFeed(
  source: AlertNotificationSource,
  account: Accessor<string | undefined>
) {
  const [latest, setLatest] = createSignal<{
    account: string;
    notification: UnifiedNotification;
  }>();
  createEffect(() => {
    const owner = account();
    if (!owner) return;
    let subscribed = true;
    const unsubscribe = source.subscribe((notification) => {
      if (
        subscribed &&
        owner === account() &&
        notification.notification_metadata.tag === 'reminder'
      )
        setLatest({ account: owner, notification });
    });
    onCleanup(() => {
      subscribed = false;
      unsubscribe();
    });
  });

  const snapshot = () =>
    !account() || source.isLoading() ? [] : source.notifications();
  const buffered = createMemo<{
    account: string | undefined;
    latest: ReturnType<typeof latest>;
    pending: Map<string, UnifiedNotification>;
    acknowledged: Set<string>;
  }>((previous) => {
    const owner = account();
    const event = latest();
    const pending = new Map(
      previous?.account === owner ? previous?.pending : undefined
    );
    // Keep observed acknowledgements after pagination removes the query row,
    // so a later delivery id cannot resurrect the same occurrence.
    const acknowledged = new Set(
      previous?.account === owner ? previous?.acknowledged : undefined
    );
    if (event && event !== previous?.latest && event.account === owner) {
      pending.set(event.notification.id, event.notification);
    }
    // Once confirmed by the query, its lifecycle belongs to that query. Replays
    // may have different delivery ids for the same occurrence; removing the
    // query item must not resurrect any of those old websocket copies.
    const confirmed = new Set<string>();
    for (const item of snapshot()) {
      pending.delete(item.id);
      const identity = reminderAlertIdentity(item);
      if (identity) {
        confirmed.add(identity.key);
        if (item.state !== 'unseen' || item.deleted_at)
          acknowledged.add(identity.key);
      }
    }
    for (const [id, item] of pending) {
      const identity = reminderAlertIdentity(item);
      if (
        identity &&
        (confirmed.has(identity.key) || acknowledged.has(identity.key))
      )
        pending.delete(id);
    }
    return { account: owner, latest: event, pending, acknowledged };
  });

  return createMemo(() =>
    reminderAlertsFromNotifications([
      ...snapshot(),
      ...[...buffered().pending.values()].map(
        (notification) =>
          source.withLocalOverrides?.(notification) ?? notification
      ),
    ]).filter((item) => !buffered().acknowledged.has(item.key))
  );
}
