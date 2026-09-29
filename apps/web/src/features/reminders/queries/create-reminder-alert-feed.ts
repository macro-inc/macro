import { isMutedItem } from '@entity/utils/notification';
import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import {
  reminderAlertIdentity,
  reminderAlertsFromNotifications,
} from './reminder-alerts';

export type AlertNotificationSource = Pick<
  NotificationSource,
  | 'notifications'
  | 'isLoading'
  | 'subscribe'
  | 'withLocalOverrides'
  | 'mutedEntities'
> & {
  /** Observing alerts must not activate the lazy full notification query. */
  isStarted: Accessor<boolean>;
};

/** New deliveries must alert even if their entity is outside loaded Soup pages. */
export function createReminderAlertFeed(
  source: AlertNotificationSource,
  account: Accessor<string | undefined>
) {
  const [latest, setLatest] = createSignal<{
    account: string;
    notification: UnifiedNotification;
  }>();
  // Switching transports can return the full query to its idle state. Retain
  // this account's last ready page until another ready page replaces it; an
  // idle/loading query is not evidence that its notifications were removed.
  const readySnapshot = createMemo<{
    account: string | undefined;
    notifications: UnifiedNotification[];
  }>((previous) => {
    const owner = account();
    if (!owner) return { account: owner, notifications: [] };
    if (!source.isStarted() || source.isLoading())
      return previous?.account === owner
        ? previous
        : { account: owner, notifications: [] };
    return { account: owner, notifications: source.notifications() };
  });
  const snapshot = () => readySnapshot().notifications;

  const [clock, setClock] = createSignal(Date.now());
  const activeMutes = createMemo(() => {
    clock();
    const now = Date.now();
    return !account()
      ? []
      : source
          .mutedEntities()
          .filter(
            (item) =>
              !item.snoozed_until || Date.parse(item.snoozed_until) > now
          );
  });
  // Snooze expiry must restore an unseen card even when no query/live update
  // arrives. Keep its occurrence buffered rather than acknowledging it.
  createEffect(() => {
    const nextExpiry = Math.min(
      ...activeMutes().flatMap((item) =>
        item.snoozed_until ? [Date.parse(item.snoozed_until)] : []
      )
    );
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.min(Math.max(0, nextExpiry - Date.now()), 2_147_483_647)
    );
    onCleanup(() => clearTimeout(timer));
  });
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

  createEffect(() => {
    const owner = account();
    if (!owner) return;
    let subscribed = true;
    const unsubscribe = source.subscribe((notification) => {
      if (
        subscribed &&
        owner === account() &&
        notification.notification_metadata.tag === 'reminder'
      ) {
        setLatest({ account: owner, notification });
        // A producer may deliver several items inside one Solid batch. Read
        // the reducer at each event boundary so every delivery is committed
        // before `latest` can be replaced, even without a foreground consumer.
        untrack(buffered);
      }
    });
    onCleanup(() => {
      subscribed = false;
      unsubscribe();
    });
  });

  return createMemo(() =>
    reminderAlertsFromNotifications(
      [...snapshot(), ...buffered().pending.values()]
        .map(
          (notification) =>
            source.withLocalOverrides?.(notification) ?? notification
        )
        .filter(
          (notification) =>
            !isMutedItem(activeMutes(), {
              item_id: notification.entity_id,
              item_type: notification.entity_type,
            })
        )
    ).filter((item) => !buffered().acknowledged.has(item.key))
  );
}
