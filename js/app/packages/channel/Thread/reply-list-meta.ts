import type { ApiThreadReply } from '@service-comms/client';
import type { ChannelMessageListMeta } from '../Message';
import { shouldGroupWithPreviousMessage } from '../Channel/message-grouping-meta';

export function buildThreadReplyListMeta(
  replies: ApiThreadReply[]
): Record<string, ChannelMessageListMeta> {
  return replies.reduce<Record<string, ChannelMessageListMeta>>(
    (metaById, reply, index, items) => {
      metaById[reply.id] = {
        index,
        isNewMessage: false,
        isFirstNewMessage: false,
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
