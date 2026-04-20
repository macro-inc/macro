import type { DateValue } from '@core/util/date';
import type { ChannelMessagesData } from '@queries/channel/channel-messages';
import type { ApiChannelMessage } from '@service-comms/client';

/** Minimal shape needed by isNewMessage — satisfied by both ApiChannelMessage and ApiThreadReply. */
export type NewMessageCheckable = { created_at: string; sender_id: string };

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

export function isNewMessage(
  message: NewMessageCheckable,
  ctx: {
    dismissed: boolean;
    lastViewedAt: DateValue | undefined | null;
    openedAt: Date;
    userId: string | undefined;
  }
): boolean {
  if (ctx.dismissed) return false;

  const lastViewed = ctx.lastViewedAt;
  if (!lastViewed) return false;

  const createdAt = new Date(message.created_at);

  return (
    createdAt > new Date(lastViewed) &&
    createdAt < ctx.openedAt &&
    ctx.userId !== message.sender_id
  );
}
