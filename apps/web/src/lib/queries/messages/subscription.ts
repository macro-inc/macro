import { useEntitySubscription } from '@service-connection/client';
import type { TrackEntityMessage } from '@service-connection/generated/schemas/trackEntityMessage';
import type { MessageParent } from '@service-storage/messages';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { catchUpTrackedChannel } from './graphql/channel-sync';
import { messageKeys } from './keys';

function invalidateParent(
  entity: Pick<TrackEntityMessage, 'entity_id' | 'entity_type'>
) {
  const parent = { type: entity.entity_type, id: entity.entity_id };
  // A channel that follows its change sequence asks for what it missed while
  // it was not subscribed; its loaded pages and threads are not read again.
  const caughtUp =
    entity.entity_type === 'channel' &&
    catchUpTrackedChannel({ type: 'channel', id: entity.entity_id });
  const keys = caughtUp
    ? [messageKeys.messagesByIds]
    : [
        messageKeys.messages,
        messageKeys.messagesByIds,
        messageKeys.threadReplies,
      ];
  for (const key of keys) {
    queryClient.invalidateQueries({ queryKey: [...key._def, parent] });
  }
}

/** Each view holds a reference to its source parent's tracking subscription. */
export function useMessageSubscription(parent: Accessor<MessageParent>) {
  useEntitySubscription(
    () => ({ entity_type: parent().type, entity_id: parent().id }),
    invalidateParent
  );
}
