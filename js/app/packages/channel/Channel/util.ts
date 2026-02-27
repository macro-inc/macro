import type { ChannelMessagesData } from '@queries/channel/channel-messages';
import type { ApiChannelMessage } from '@service-comms/client';

export function flattenMessages(
  data: ChannelMessagesData | undefined
): ApiChannelMessage[] {
  if (!data?.pages?.length) return [];
  const all: ApiChannelMessage[] = [];
  for (let i = data.pages.length - 1; i >= 0; i--) {
    const items = data.pages[i].items;
    for (let j = items.length - 1; j >= 0; j--) {
      all.push(items[j]);
    }
  }
  return all;
}

export function isNewMessage(message: ApiChannelMessage) {
  if (newMessagesDismissed()) return false;

  const lastViewed = lastViewedAt();
  if (!lastViewed) return false;

  const openedAt = openedChannelAt();
  const createdAt = new Date(message.created_at);

  return (
    createdAt > new Date(lastViewed) &&
    createdAt < openedAt &&
    userId() !== message.sender_id
  );
}
