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
  return {
    root: () =>
      query.isSuccess ? messageToMessageData(query.data.root) : undefined,
    replies: () =>
      query.isSuccess ? query.data.replies.map(messageToMessageData) : [],
    replyCount: () => (query.isSuccess ? query.data.replies.length : undefined),
  };
}
