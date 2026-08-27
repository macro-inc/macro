import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { ChannelMessageListMeta } from '../Message/list-meta';
import { shouldGroupWithPreviousMessage } from './message-grouping-meta';

export function buildChannelMessageListMeta(
  messages: ApiChannelMessage[],
  isNewMessageFn: (message: ApiChannelMessage) => boolean,
  reachedStart: boolean,
  /**
   * A thread is visually open for this message even without replies (e.g. a
   * reply is being composed), so the rail must reach it.
   */
  isThreadOpen?: (message: ApiChannelMessage) => boolean
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
      reachedStart,
    };

    previousTopLevelCreatedAt = message.created_at;
    previousMessage = message;
  }

  // Backward pass: a row carries the rail through it when a later member of
  // its sender run owns a thread (the rail runs from the run's header avatar
  // down to that fork point).
  for (let i = messages.length - 2; i >= 0; i--) {
    const next = messages[i + 1]!;
    const nextMeta = metaByMessageId[next.id]!;
    if (!nextMeta.isGroupedWithPrevious) continue;
    metaByMessageId[messages[i]!.id]!.threadRailBelow =
      (next.thread?.reply_count ?? 0) > 0 ||
      isThreadOpen?.(next) === true ||
      nextMeta.threadRailBelow === true;
  }

  return metaByMessageId;
}
