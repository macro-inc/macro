import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useNotificationsForEntity } from '@notifications/notification-helpers';
import type { UnifiedNotification } from '@notifications/types';
import type { MessageParent } from '@service-storage/messages';
import type { JSXElement } from 'solid-js';
import {
  type Accessor,
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
} from 'solid-js';

/** A channel can supply its complete edge without activating the global feed. */
export const MessageNotificationSourceContext =
  createContext<Accessor<UnifiedNotification[]>>();

const MAX_MARK_ATTEMPTS = 3;

export function MarkMessageNotifications(props: {
  messageId: string;
  parent: MessageParent;
  children: JSXElement;
}) {
  // TODO(dev-rb/notifications): Stop discovering message notifications through the
  // global NotificationSource. Use an exact-message GraphQL edge or scope that
  // matches metadata.messageId only; the current CHANNEL_MESSAGE entity scope
  // is thread-aware, so targeting a root also includes reply notifications.
  const notificationSource = useGlobalNotificationSource();
  const scopedNotifications = useContext(MessageNotificationSourceContext);
  const notifications =
    scopedNotifications ??
    useNotificationsForEntity(notificationSource, props.parent);
  const isMessageNotification = (n: UnifiedNotification) => {
    const content = n.notification_metadata.content;
    return (
      ('messageId' in content && content.messageId === props.messageId) ||
      ('commentId' in content && String(content.commentId) === props.messageId)
    );
  };

  // A message can generate several notifications — notably one
  // `document_mention` per mentioned document. Mark every notification for
  // this message in one batch; selecting only the first leaves the rest unread
  // and makes a channel row keep targeting the same message.
  //
  // Not a one-shot latch: a stale refetch can land after the optimistic write
  // and flip notifications back to unviewed while this row stays mounted, so
  // re-mark whenever the cache regresses, bounded per mount. inFlight is a
  // signal so a regression that lands mid-mark re-runs the effect on settle.
  const [inFlight, setInFlight] = createSignal(false);
  const [visible, setVisible] = createSignal(!scopedNotifications);
  let container: HTMLDivElement | undefined;
  onMount(() => {
    if (!scopedNotifications || !container) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
    });
    observer.observe(container);
    onCleanup(() => observer.disconnect());
  });
  let attempts = 0;
  let attemptedIds = '';

  createEffect(() => {
    // Virtual rows include overscan. Mounting an offscreen reply is not reading it.
    if (!visible()) return;
    const unread = notifications().filter(
      (notification) =>
        isMessageNotification(notification) && notification.state === 'unseen'
    );
    if (scopedNotifications && unread.length > 0 && !inFlight()) {
      const ids = unread
        .map((notification) => notification.id)
        .sort()
        .join(',');
      if (ids !== attemptedIds) {
        attemptedIds = ids;
        attempts = 0;
      }
    }
    if (unread.length === 0 || inFlight() || attempts >= MAX_MARK_ATTEMPTS) {
      return;
    }
    attempts += 1;
    setInFlight(true);
    void notificationSource
      .bulkMarkAsRead(unread)
      .catch((error) => {
        console.error('Failed to mark message notifications as read', error);
      })
      .finally(() => {
        setInFlight(false);
      });
  });

  return scopedNotifications ? (
    <div ref={container}>{props.children}</div>
  ) : (
    <>{props.children}</>
  );
}
