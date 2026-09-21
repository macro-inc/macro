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
    acknowledgedDeliveries: Map<string, string>;
    acknowledged: Set<string>;
  }>((previous) => {
    const owner = account();
    const event = latest();
    const pending = new Map(
      previous?.account === owner ? previous?.pending : undefined
    );
    // Remember which delivery acknowledged an occurrence after its query row
    // leaves. Only that delivery rolling back to unseen revokes its memory;
    // a different, stale unseen delivery must not resurrect the occurrence.
    const acknowledgedDeliveries = new Map(
      previous?.account === owner ? previous?.acknowledgedDeliveries : undefined
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
          acknowledgedDeliveries.set(item.id, identity.key);
        else acknowledgedDeliveries.delete(item.id);
      }
    }
    const acknowledged = new Set(acknowledgedDeliveries.values());
    for (const [id, item] of pending) {
      const identity = reminderAlertIdentity(item);
      if (
        identity &&
        (confirmed.has(identity.key) || acknowledged.has(identity.key))
      )
        pending.delete(id);
    }
    return {
      account: owner,
      latest: event,
      pending,
      acknowledgedDeliveries,
      acknowledged,
    };
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
