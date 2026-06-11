import {
  handleCommsAttachment,
  handleCommsMessage,
  handleCommsReaction,
} from '@queries/channel/sync';
import { handleCommsTyping } from '@queries/channel/typing';
import { invalidateContacts } from '@queries/contacts/contacts';
import { handleRefreshEmail } from '@queries/email/sync';
import {
  applyNotificationStatusUpdate,
  notificationStatusUpdatePayloadSchema,
} from '@queries/notification/user-notifications';
import { handleTaskDuplicateMatchesUpdated } from '@queries/storage/task-duplicates';
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

function parseWebsocketPayload<T>(
  type: string,
  payload: unknown
): T | undefined {
  if (typeof payload !== 'string') return payload as T;

  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    console.warn('Malformed websocket payload', { type, payload, error });
    return undefined;
  }
}

function withParsedWebsocketPayload<T>(
  type: string,
  payload: unknown,
  handle: (payload: T) => void
): void {
  const parsedPayload = parseWebsocketPayload<T>(type, payload);
  if (parsedPayload === undefined) return;

  handle(parsedPayload);
}

export function QuerySyncProvider(props: SyncProviderProps) {
  createConnectionWebsocketEffect((data) => {
    match(data)
      .with({ type: 'contacts_invalidation' }, () => {
        invalidateContacts();
      })
      .with({ type: 'comms_message' }, () => {
        withParsedWebsocketPayload(data.type, data.data, handleCommsMessage);
      })
      .with({ type: 'comms_reaction' }, () => {
        withParsedWebsocketPayload(data.type, data.data, handleCommsReaction);
      })
      .with({ type: 'comms_attachment' }, () => {
        withParsedWebsocketPayload(data.type, data.data, handleCommsAttachment);
      })
      .with({ type: 'comms_typing' }, () => {
        const userId = props.userId();
        if (!userId) return;
        withParsedWebsocketPayload<Parameters<typeof handleCommsTyping>[0]>(
          data.type,
          data.data,
          (payload) => {
            handleCommsTyping(payload, userId);
          }
        );
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
      .with({ type: 'refresh_email' }, () => {
        handleRefreshEmail(data.data);
      })
      .with({ type: 'task_duplicate_matches_updated' }, () => {
        withParsedWebsocketPayload(
          data.type,
          data.data,
          handleTaskDuplicateMatchesUpdated
        );
      })
      .otherwise(() => {});
  });

  return props.children;
}
