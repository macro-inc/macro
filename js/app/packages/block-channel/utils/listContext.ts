export type MinimalMessage = {
  id: string;
  created_at: string;
  sender_id: string;
};

export type MessageListContext<T extends MinimalMessage = MinimalMessage> = {
  index: number;
  isNewMessage: boolean;
  isParentNewMessage: boolean;
  threadIndex: number;
  /** The previous non-threaded message outside of the current thread */
  previousNonThreadedMessage: T | undefined;
  /** True if the message is in a thread and the parent is the last top-level message */
  isInLastThread: boolean;
};

export type MessageListContextLookup<T extends MinimalMessage = MinimalMessage> =
  Record<string, MessageListContext<T>>;

function findLastNonThreadedMessageIndex<T extends MinimalMessage>(
  messages: T[],
  fromIndex: number,
  getThreadId: (message: T) => string | undefined,
) {
  for (let i = fromIndex; i >= 0; i--) {
    const message = messages[i];
    if (!getThreadId(message)) {
      return i;
    }
  }
  return -1;
}

export function createMessageListContextLookup<
  T extends MinimalMessage = MinimalMessage,
>({
  messages,
  isNewMessageFn,
  getThreadId = () => undefined,
}: {
  messages: T[];
  isNewMessageFn: (message: T) => boolean;
  getThreadId?: (message: T) => string | undefined;
}) {
  const context: MessageListContextLookup<T> = {};
  const threadIndexCounters = new Map<string, number>();
  const messagesById = new Map<string, [number, T]>();

  for (const [index, message] of messages.entries()) {
    messagesById.set(message.id, [index, message]);
  }

  // Find the last top-level message (last message without a thread_id)
  let lastTopLevelMessageId: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!getThreadId(messages[i])) {
      lastTopLevelMessageId = messages[i].id;
      break;
    }
  }

  for (const [messageIndex, message] of messages.entries()) {
    const threadId = getThreadId(message);
    const isNewMessage = !threadId && isNewMessageFn(message);
    let threadIndex = -1;
    let previousNonThreadedMessage: T | undefined;
    let isParentNewMessage = false;
    let backTrackIndex = messageIndex;

    if (threadId) {
      const foundParent = messagesById.get(threadId);

      if (foundParent) {
        const [parentIndex, parentMessage] = foundParent;
        backTrackIndex = parentIndex;
        isParentNewMessage = isNewMessageFn(parentMessage);

        const currentCount = threadIndexCounters.get(threadId) || 0;
        threadIndex = currentCount;
        threadIndexCounters.set(threadId, currentCount + 1);
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
        backTrackIndex - 1,
        getThreadId,
      );

      if (previousNonThreadedMessageIndex >= 0) {
        previousNonThreadedMessage = messages[previousNonThreadedMessageIndex];
      }
    }

    // Check if message is in the last thread
    const isInLastThread =
      threadId !== null &&
      threadId !== undefined &&
      threadId === lastTopLevelMessageId;

    context[message.id] = {
      index: messageIndex,
      isNewMessage: isNewMessage,
      isParentNewMessage: isParentNewMessage,
      threadIndex,
      previousNonThreadedMessage,
      isInLastThread,
    };
  }

  return context;
}
