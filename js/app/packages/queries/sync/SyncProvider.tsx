import {
  handleCommsAttachment,
  handleCommsMessage,
  handleCommsReaction,
} from '@queries/channel/sync';
import { handleCommsTyping } from '@queries/channel/typing';
import { invalidateContacts } from '@queries/contacts/contacts';
import {
  applyNotificationStatusUpdate,
  type NotificationStatusUpdate,
} from '@queries/notification/user-notifications';
// Side-effect import: registers the scheduled-action live-update websocket
// listener. Must be imported somewhere that always loads on app start — this
// provider is guaranteed to mount alongside the other sync handlers.
import '@queries/agent-schedule/sync';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type { Accessor, ParentProps } from 'solid-js';
import { match } from 'ts-pattern';
import { z } from 'zod';

type SyncProviderProps = ParentProps<{
  userId: Accessor<string | undefined>;
}>;

const notificationStatusUpdateSchema = z.object({
  type: z.literal('notification_status_updated'),
  updates: z.array(
    z.discriminatedUnion('t', [
      z.object({
        t: z.literal('Patch'),
        c: z.object({
          id: z.string(),
          done: z.boolean(),
          viewed_at: z.string().nullable(),
          updated_at: z.string(),
        }),
      }),
      z.object({
        t: z.literal('Delete'),
        c: z.object({
          id: z.string(),
        }),
      }),
    ])
  ),
}) satisfies z.ZodType<NotificationStatusUpdate>;

export function QuerySyncProvider(props: SyncProviderProps) {
  createConnectionWebsocketEffect((data) => {
    const payload =
      typeof data.data === 'string' ? JSON.parse(data.data) : data.data;

    match(data)
      .with({ type: 'contacts_invalidation' }, () => {
        invalidateContacts();
      })
      .with({ type: 'comms_message' }, () => {
        handleCommsMessage(payload);
      })
      .with({ type: 'comms_reaction' }, () => {
        handleCommsReaction(payload);
      })
      .with({ type: 'comms_attachment' }, () => {
        handleCommsAttachment(payload);
      })
      .with({ type: 'comms_typing' }, () => {
        const userId = props.userId();
        if (!userId) return;
        handleCommsTyping(payload, userId);
      })
      .with({ type: 'notification_status_updated' }, () => {
        const result = notificationStatusUpdateSchema.safeParse(payload);
        if (!result.success) {
          console.warn('Malformed notification status update payload', payload);
          return;
        }
        applyNotificationStatusUpdate(result.data);
      })
      .otherwise(() => {});
  });

  return props.children;
}
