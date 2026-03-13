import type { ApiThreadReply } from '@service-comms/client';
import type { ChannelMessageListMeta } from '../Message';
import { shouldGroupWithPreviousMessage } from '../Channel/message-grouping-meta';
import type { NewMessageCheckable } from '../Channel/util';

export function buildThreadReplyListMeta(
  replies: ApiThreadReply[],
  isNewMessageFn?: (message: NewMessageCheckable) => boolean
): Record<string, ChannelMessageListMeta> {
  let foundFirstNewMessage = false;

  return replies.reduce<Record<string, ChannelMessageListMeta>>(
    (metaById, reply, index, items) => {
      const isNewMessage = isNewMessageFn?.(reply) ?? false;
      const isFirstNewMessage = isNewMessage && !foundFirstNewMessage;

      if (isFirstNewMessage) {
        foundFirstNewMessage = true;
      }

      metaById[reply.id] = {
        index,
        isNewMessage,
        isFirstNewMessage,
        isGroupedWithPrevious: shouldGroupWithPreviousMessage(
          reply,
          items[index - 1]
        ),
      };
      return metaById;
    },
    {}
  );
}
