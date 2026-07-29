import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  isChannelNotification,
  useNotificationsForEntity,
} from '@notifications/notification-helpers';
import type { UnifiedNotification } from '@notifications/types';
import type { JSXElement } from 'solid-js';
import { createEffect, createSignal } from 'solid-js';

const MAX_MARK_ATTEMPTS = 3;

export function MarkMessageNotifications(props: {
  messageId: string;
  channelId: string;
  children: JSXElement;
}) {
  const notificationSource = useGlobalNotificationSource();
  const notifications = useNotificationsForEntity(notificationSource, {
    type: 'channel',
    id: props.channelId,
  });
  const isMessageNotification = (n: UnifiedNotification) =>
    isChannelNotification(n) &&
    n.notification_metadata.content.messageId === props.messageId;

  // Not a one-shot latch: a stale refetch can land after the optimistic write
  // and flip the notification back to unviewed while this row stays mounted,
  // so re-mark whenever the cache regresses, bounded per mount. inFlight is a
  // signal so a regression that lands mid-mark re-runs the effect on settle.
  const [inFlight, setInFlight] = createSignal(false);
  let attempts = 0;

  createEffect(() => {
    const existing = notifications().find(isMessageNotification);
    if (
      !existing ||
      existing.viewed_at ||
      inFlight() ||
      attempts >= MAX_MARK_ATTEMPTS
    ) {
      return;
    }
    attempts += 1;
    setInFlight(true);
    notificationSource.markAsRead(existing).finally(() => {
      setInFlight(false);
    });
  });

  return <>{props.children}</>;
}
