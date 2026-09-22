import { useEntitySubscription } from '@service-connection/client';
import type { TrackEntityMessage } from '@service-connection/generated/schemas/trackEntityMessage';
import type { MessageParent } from '@service-storage/messages';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { messageKeys } from './keys';

function invalidateParent(
  entity: Pick<TrackEntityMessage, 'entity_id' | 'entity_type'>
) {
  const parent = { type: entity.entity_type, id: entity.entity_id };
  for (const key of [
    messageKeys.messages,
    messageKeys.messagesByIds,
    messageKeys.threadReplies,
  ]) {
    void queryClient.invalidateQueries({ queryKey: [...key._def, parent] });
  }
}

/** Each view holds a reference to its source parent's tracking subscription. */
export function useMessageSubscription(parent: Accessor<MessageParent>) {
  useEntitySubscription(
    () => ({ entity_type: parent().type, entity_id: parent().id }),
    invalidateParent
  );
}
