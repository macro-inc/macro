import { fireAndForget } from '@core/util/fireAndForget';
import { markNotificationsForEntityAsRead } from '@notifications/notification-helpers';
import type { NotificationSource } from '@notifications/notification-source';
import { debounce } from '@solid-primitives/scheduled';
import { Show } from 'solid-js';

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

  const markRead = async () => {
    try {
      await markNotificationsForEntityAsRead(props.notificationSource, entity);
    } catch (error) {
      console.error(
        'Failed to mark agent session notifications as read',
        error
      );
    }
  };
  const scheduleRead = debounce(
    () => fireAndForget(markRead(), 'agent-session'),
    2_000
  );

  // The notification feed never holds agent sessions and reading it would
  // load it, so the opened session is marked once without observing the feed.
  // Leaving the session before the debounce fires cancels the mark.
  scheduleRead();

  return null;
}
