import {
  handleCommsAttachment,
  handleCommsMessage,
  handleCommsReaction,
} from '@queries/channel/sync';
import { handleCommsTyping } from '@queries/channel/typing';
import { invalidateContacts } from '@queries/contacts/contacts';
import {
  applyNotificationStatusUpdate,
  notificationStatusUpdatePayloadSchema,
} from '@queries/notification/user-notifications';
// Side-effect import: registers the scheduled-action live-update websocket
// listener. Must be imported somewhere that always loads on app start — this
// provider is guaranteed to mount alongside the other sync handlers.
import '@queries/agent-schedule/sync';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type { Accessor, ParentProps } from 'solid-js';
import { match } from 'ts-pattern';

type SyncProviderProps = ParentProps<{
  userId: Accessor<string | undefined>;
}>;

export function QuerySyncProvider(props: SyncProviderProps) {
  createConnectionWebsocketEffect((data) => {
    match(data)
      .with({ type: 'contacts_invalidation' }, () => {
        invalidateContacts();
      })
      .with({ type: 'comms_message' }, () => {
        handleCommsMessage(data.data);
      })
      .with({ type: 'comms_reaction' }, () => {
        handleCommsReaction(data.data);
      })
      .with({ type: 'comms_attachment' }, () => {
        handleCommsAttachment(data.data);
      })
      .with({ type: 'comms_typing' }, () => {
        const userId = props.userId();
        if (!userId) return;
        handleCommsTyping(data.data, userId);
      })
      .with({ type: 'notification_status_updated' }, () => {
        const result = notificationStatusUpdatePayloadSchema.safeParse(
          data.data
        );
        if (!result.success) {
          console.warn(
            'Malformed notification status update payload',
            data.data
          );
          return;
        }
        applyNotificationStatusUpdate(result.data);
      })
      .otherwise(() => {});
  });

  return props.children;
}
