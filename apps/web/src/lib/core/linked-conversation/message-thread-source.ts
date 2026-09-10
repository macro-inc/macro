import { messageToMessageData } from '@core/messages/message-data';
import { useMessageThreadQuery } from '@queries/messages';
import type { MessageParent } from '@service-storage/messages';
import type { Accessor } from 'solid-js';
import type { LinkedConversationSource } from './types';

/** A linked thread uses the same messages and live updates on documents and channels. */
export function createMessageThreadSource(
  parent: Accessor<MessageParent>,
  id: Accessor<string>
): LinkedConversationSource {
  const query = useMessageThreadQuery(parent, id);
  const thread = () =>
    query.isSuccess && !query.data.state.deleted_at ? query.data : undefined;
  return {
    root: () => {
      const value = thread();
      return value ? messageToMessageData(value.root) : undefined;
    },
    replies: () => thread()?.replies.map(messageToMessageData) ?? [],
    replyCount: () => thread()?.replies.length,
    unavailable: () =>
      query.isError || (query.isSuccess && !!query.data.state.deleted_at),
  };
}
