import { invalidateContacts } from '@queries/contacts/contacts';
import {
  handleCommsAttachment,
  handleCommsMessage,
  handleCommsReaction,
} from '@queries/channel/sync';
import { handleCommsTyping } from '@queries/channel/typing';
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
      .otherwise(() => {});
  });

  return props.children;
}
