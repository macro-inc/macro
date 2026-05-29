import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { ChannelMessageListMeta } from '../Message/list-meta';
import { shouldGroupWithPreviousMessage } from './message-grouping-meta';

export function buildChannelMessageListMeta(
  messages: ApiChannelMessage[],
  isNewMessageFn: (message: ApiChannelMessage) => boolean
): Record<string, ChannelMessageListMeta> {
  const metaByMessageId: Record<string, ChannelMessageListMeta> = {};
  let previousTopLevelCreatedAt: string | undefined;
  let previousMessage: ApiChannelMessage | undefined;
  let foundFirstNewMessage = false;

  for (const [index, message] of messages.entries()) {
    const isNewMessage = isNewMessageFn(message);
    const isFirstNewMessage = isNewMessage && !foundFirstNewMessage;

    if (isFirstNewMessage) {
      foundFirstNewMessage = true;
    }

    metaByMessageId[message.id] = {
      index,
      isNewMessage,
      isFirstNewMessage,
      previousTopLevelCreatedAt,
      isGroupedWithPrevious: shouldGroupWithPreviousMessage(
        message,
        previousMessage
      ),
    };

    previousTopLevelCreatedAt = message.created_at;
    previousMessage = message;
  }

  return metaByMessageId;
}
