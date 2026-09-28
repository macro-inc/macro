import { markNotificationsForEntityAsRead } from '@notifications/notification-helpers';
import type { NotificationSource } from '@notifications/notification-source';
import { compositeEntity } from '@notifications/types';
import { debounce } from '@solid-primitives/scheduled';
import { createEffect, Show } from 'solid-js';

/** Mark only the loaded conversation in the active split, never sidebar rows. */
export function AgentSessionReadMarker(props: {
  sessionId?: string;
  active: boolean;
  notificationSource: NotificationSource;
}) {
  return (
    <Show when={props.active && props.sessionId} keyed>
      {(id) => (
        <ActiveSessionReadMarker
          sessionId={id}
          notificationSource={props.notificationSource}
        />
      )}
    </Show>
  );
}

function ActiveSessionReadMarker(props: {
  sessionId: string;
  notificationSource: NotificationSource;
}) {
  const entity = { type: 'agent_session', id: props.sessionId } as const;
  const unread = () =>
    (
      props.notificationSource.notificationsByEntity()[
        compositeEntity(entity)
      ] ?? []
    ).filter((notification) => notification.state === 'unseen');
  const attempted = new Set<string>();
  let markedInitialView = false;

  const markRead = async () => {
    markedInitialView = true;
    for (const notification of unread()) attempted.add(notification.id);
    try {
      await markNotificationsForEntityAsRead(props.notificationSource, entity);
    } catch (error) {
      console.error(
        'Failed to mark agent session notifications as read',
        error
      );
    }
  };
  const scheduleRead = debounce(() => void markRead(), 2_000);

  // Notification loading and incoming updates can happen after the session
  // mounts. Observe those external events for the lifetime of the active view;
  // an optimistic seen update must not schedule another mutation.
  createEffect(() => {
    if (props.notificationSource.isLoading()) {
      scheduleRead.clear();
      return;
    }
    const notifications = unread();
    if (
      markedInitialView &&
      !notifications.some((notification) => !attempted.has(notification.id))
    ) {
      return;
    }
    scheduleRead();
  });

  return null;
}
