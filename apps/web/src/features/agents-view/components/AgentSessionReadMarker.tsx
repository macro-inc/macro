import { DebouncedNotificationReadMarker } from '@notifications/components/DebouncedNotificationReadMarker';
import type { NotificationSource } from '@notifications/notification-source';
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
        <DebouncedNotificationReadMarker
          notificationSource={props.notificationSource}
          entity={{ type: 'agent_session', id }}
        />
      )}
    </Show>
  );
}
