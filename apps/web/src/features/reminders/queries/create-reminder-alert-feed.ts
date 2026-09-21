import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import { reminderAlertsFromNotifications } from './reminder-alerts';

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
  onCleanup(
    source.subscribe((notification) => {
      const owner = account();
      if (owner && notification.notification_metadata.tag === 'reminder')
        setLatest({ account: owner, notification });
    })
  );

  const snapshot = () =>
    !account() || source.isLoading() ? [] : source.notifications();
  const buffered = createMemo<{
    account: string | undefined;
    latest: ReturnType<typeof latest>;
    pending: Map<string, UnifiedNotification>;
  }>((previous) => {
    const owner = account();
    const event = latest();
    const pending = new Map(
      previous?.account === owner ? previous?.pending : undefined
    );
    if (event && event !== previous?.latest && event.account === owner) {
      pending.set(event.notification.id, event.notification);
    }
    // Once confirmed by the query, its lifecycle belongs to that query. A later
    // removal must not resurrect an old websocket copy.
    for (const item of snapshot()) pending.delete(item.id);
    return { account: owner, latest: event, pending };
  });

  return createMemo(() =>
    reminderAlertsFromNotifications([
      ...snapshot(),
      ...[...buffered().pending.values()].map(
        (notification) =>
          source.withLocalOverrides?.(notification) ?? notification
      ),
    ])
  );
}
