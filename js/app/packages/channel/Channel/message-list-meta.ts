import type { ApiChannelMessage } from '@service-comms/client';
import type { ChannelMessageListMeta } from '../Message/list-meta';
import type { Store } from 'solid-js/store';

function createChannelMessageListMetaStore(
  messages: ApiChannelMessage[],
  isNewMessageFn: (message: ApiChannelMessage) => boolean
): Store<string, ChannelMessageListMeta> {}

export function buildChannelMessageListMeta(
  messages: ApiChannelMessage[],
  isNewMessageFn: (message: ApiChannelMessage) => boolean
): Record<string, ChannelMessageListMeta> {
  const metaByMessageId: Record<string, ChannelMessageListMeta> = {};
  let previousTopLevelCreatedAt: string | undefined;
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
    };

    previousTopLevelCreatedAt = message.created_at;
  }

  return metaByMessageId;
}
