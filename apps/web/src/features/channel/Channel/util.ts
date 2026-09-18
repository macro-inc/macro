import type { DateValue } from '@core/util/date';
import type { MessageTimelineData } from '@queries/messages/timeline';
import type { MessageListItem } from '@service-storage/messages';

/** Minimal shape needed by isNewMessage — satisfied by both MessageListItem and EntityMessage. */
export type NewMessageCheckable = { created_at: string; sender_id: string };

export function flattenMessages(
  data: MessageTimelineData | undefined
): MessageListItem[] {
  if (!data?.pages?.length) return [];
  const all: MessageListItem[] = [];
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
