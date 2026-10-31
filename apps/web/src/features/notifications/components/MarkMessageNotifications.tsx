import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { useNotificationsForEntity } from '@notifications/notification-helpers';
import type { UnifiedNotification } from '@notifications/types';
import type { MessageParent } from '@service-storage/messages';
import type { JSXElement } from 'solid-js';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  useContext,
} from 'solid-js';
import { useMessageReadVisibility } from './MessageReadVisibility';

/** Share exact unread matches so each message avoids scanning the channel history. */
export const MessageNotificationIndexContext =
  createContext<Accessor<ReadonlyMap<string, UnifiedNotification[]>>>();

const MAX_MARK_ATTEMPTS = 3;

export function MarkMessageNotifications(props: {
  messageId: string;
  parent: MessageParent;
  element: HTMLElement | undefined;
  children: JSXElement;
}) {
  // TODO(dev-rb/notifications): Stop discovering message notifications through the
  // global NotificationSource. Use an exact-message GraphQL edge or scope that
  // matches metadata.messageId only; the current CHANNEL_MESSAGE entity scope
  // is thread-aware, so targeting a root also includes reply notifications.
  const notificationSource = useGlobalNotificationSource();
  const scopedIndex = useContext(MessageNotificationIndexContext);
  const notifications = scopedIndex
    ? () => scopedIndex().get(props.messageId) ?? []
    : useNotificationsForEntity(notificationSource, props.parent);
  const isMessageNotification = (n: UnifiedNotification) => {
    const content = n.notification_metadata.content;
    return (
      ('messageId' in content && content.messageId === props.messageId) ||
      ('commentId' in content && String(content.commentId) === props.messageId)
    );
  };
  const unreadNotifications = () =>
    notifications().filter(
      (notification) =>
        notification.state === 'unseen' &&
        (scopedIndex !== undefined || isMessageNotification(notification))
    );
  const batchKey = createMemo(() =>
    unreadNotifications().length
      ? JSON.stringify(
          unreadNotifications()
            .map((notification) => notification.id)
            .sort()
        )
      : ''
  );
  const visible = useMessageReadVisibility(() => props.element, batchKey);

  // A message can generate several notifications — notably one
  // `document_mention` per mentioned document. Mark every notification for
  // this message in one batch; selecting only the first leaves the rest unread
  // and makes a channel row keep targeting the same message.
  //
  // Not a one-shot latch: a stale refetch can land after the optimistic write
  // and flip notifications back to unviewed while this row stays mounted, so
  // re-mark whenever the cache regresses, bounded per notification batch.
  // New notifications get a fresh budget. inFlight is a signal so a regression
  // that lands mid-mark re-runs the effect on settle.
  const [inFlight, setInFlight] = createSignal(false);
  let attempts = 0;
  let attemptedIds = '';

  const markRead = async (unread: UnifiedNotification[]) => {
    const result = await catchToResult(() =>
      Telemetry.span('notification.message_seen', async (span) => {
        span.setAttr('message.id', props.messageId);
        span.setAttr('notification.count', unread.length);
        span.setAttr('notification.read_trigger', 'visible');
        await notificationSource.bulkMarkAsRead(unread);
      })
    );
    if (result.isErr())
      console.error(
        'Failed to mark message notifications as read',
        result.error
      );
    setInFlight(false);
  };

  createEffect(
    on(
      [unreadNotifications, inFlight, visible],
      ([unread, pending, isVisible]) => {
        if (unread.length === 0 || pending || !isVisible) return;
        const ids = JSON.stringify(
          unread.map((notification) => notification.id).sort()
        );
        if (ids !== attemptedIds) {
          attemptedIds = ids;
          attempts = 0;
        }
        if (attempts >= MAX_MARK_ATTEMPTS) return;
        attempts += 1;
        setInFlight(true);
        fireAndForget(markRead(unread), 'message-notification-read');
      }
    )
  );

  return props.children;
}
