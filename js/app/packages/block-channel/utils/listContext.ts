import type { Message } from '@service-comms/generated/models/message';

export type MinimalMessage = {
  id: string;
  created_at: string;
  sender_id: string;
  thread_id?: string | null;
};

export type MessageListContext<T extends MinimalMessage = Message> = {
  index: number;
  isNewMessage: boolean;
  isParentNewMessage: boolean;
  threadIndex: number;
  /** The previous non-threaded message outside of the current thread */
  previousNonThreadedMessage: T | undefined;
};

export type MessageListContextLookup<T extends MinimalMessage = Message> =
  Record<string, MessageListContext<T>>;

function findLastNonThreadedMessageIndex(
  messages: MinimalMessage[],
  fromIndex: number
) {
  for (let i = fromIndex; i >= 0; i--) {
    const message = messages[i];
    if (!message.thread_id) {
      return i;
    }
  }
  return -1;
}

export function createMessageListContextLookup<
  T extends MinimalMessage = Message,
>({
  messages,
  isNewMessageFn,
}: {
  messages: T[];
  isNewMessageFn: (message: T) => boolean;
}) {
  const context: MessageListContextLookup<T> = {};
  const threadIndexCounters = new Map<string, number>();
  const messagesById = new Map<string, [number, T]>();

  for (const [index, message] of messages.entries()) {
    messagesById.set(message.id, [index, message]);
  }

  for (const [messageIndex, message] of messages.entries()) {
    const isNewMessage = !message.thread_id && isNewMessageFn(message);
    let threadIndex = -1;
    let previousNonThreadedMessage: T | undefined;
    let isParentNewMessage = false;
    let backTrackIndex = messageIndex;

    if (message.thread_id) {
      const foundParent = messagesById.get(message.thread_id);

      if (foundParent) {
        const [parentIndex, parentMessage] = foundParent;
        backTrackIndex = parentIndex;
        isParentNewMessage = isNewMessageFn(parentMessage);

        const currentCount = threadIndexCounters.get(message.thread_id) || 0;
        threadIndex = currentCount;
        threadIndexCounters.set(message.thread_id, currentCount + 1);
      } else {
        console.error(
          'expected parent message for threaded message not found',
          message
        );
      }
    }

    if (messagesById.has(message.id)) {
      const previousNonThreadedMessageIndex = findLastNonThreadedMessageIndex(
        messages,
        backTrackIndex - 1
      );

      if (previousNonThreadedMessageIndex >= 0) {
        previousNonThreadedMessage = messages[previousNonThreadedMessageIndex];
      }
    }

    context[message.id] = {
      index: messageIndex,
      isNewMessage: isNewMessage,
      isParentNewMessage: isParentNewMessage,
      threadIndex,
      previousNonThreadedMessage,
    };
  }

  return context;
}
