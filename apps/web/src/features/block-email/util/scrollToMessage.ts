export type ScrollAlign = 'start' | 'end';

export type OpenTargetMessage = {
  db_id?: string | null;
  labels: Array<{ provider_label_id?: string | null }>;
};

export function isUnreadMessage(message: OpenTargetMessage): boolean {
  return message.labels.some((label) => label.provider_label_id === 'UNREAD');
}

/** `messages` is oldest-first, matching `EmailContext`. */
export function openTargetMessageId(
  messages: OpenTargetMessage[]
): string | undefined {
  if (messages.length === 0) return undefined;
  const newestId = messages.at(-1)?.db_id ?? undefined;
  if (messages.every(isUnreadMessage)) return newestId;
  return messages.find(isUnreadMessage)?.db_id ?? newestId;
}

export function shouldPageForOldestUnread(
  messages: OpenTargetMessage[],
  hasMore: boolean
): boolean {
  const oldest = messages[0];
  return hasMore && oldest != null && isUnreadMessage(oldest);
}

/** Oldest, penultimate, and newest stay visible. Hide the rest when length > 3. */
export function isTruncatedMiddleMessage(
  chronologicalIndex: number,
  length: number
): boolean {
  return length > 3 && chronologicalIndex > 0 && chronologicalIndex < length - 2;
}

export function truncatedMiddleCount(length: number): number {
  return length > 3 ? length - 3 : 0;
}

/** Next older-to-newer shown index, or null when the expand control or list end follows. */
export function nextShownChronologicalIndex(
  chronologicalIndex: number,
  length: number,
  showMiddle: boolean
): number | null {
  if (chronologicalIndex < 0 || chronologicalIndex >= length - 1) return null;
  if (!showMiddle && truncatedMiddleCount(length) > 0) {
    if (chronologicalIndex === 0) return null;
    if (chronologicalIndex === length - 2) return length - 1;
    return null;
  }
  return chronologicalIndex + 1;
}

/** Previous newer-to-older shown index, or null when the expand control or list start precedes. */
export function prevShownChronologicalIndex(
  chronologicalIndex: number,
  length: number,
  showMiddle: boolean
): number | null {
  if (chronologicalIndex <= 0 || chronologicalIndex >= length) return null;
  if (!showMiddle && truncatedMiddleCount(length) > 0) {
    if (chronologicalIndex === length - 1) return length - 2;
    return null;
  }
  return chronologicalIndex - 1;
}

export function threadMessageIsExpanded(args: {
  chronologicalIndex: number;
  listLength: number;
  expansionOverride?: boolean;
  isUnread: boolean;
  hasDraft: boolean;
}): boolean {
  if (args.expansionOverride === false) return false;
  if (args.expansionOverride === true) return true;
  return (
    args.chronologicalIndex === args.listLength - 1 ||
    args.isUnread ||
    args.hasDraft
  );
}

export function alignmentDelta(
  container: HTMLElement,
  element: HTMLElement,
  align: ScrollAlign
): number {
  const containerBox = container.getBoundingClientRect();
  const elementBox = element.getBoundingClientRect();
  switch (align) {
    case 'end':
      return elementBox.bottom - containerBox.bottom;
    case 'start':
      return elementBox.top - containerBox.top;
    default: {
      const _exhaustive: never = align;
      return _exhaustive;
    }
  }
}

export function messageElement(
  container: HTMLElement,
  messages: Array<{ db_id?: string | null }>,
  messageId: string
): HTMLElement | undefined {
  if (!messages.some((message) => message.db_id === messageId)) return undefined;
  const el = container.querySelector(
    `[data-message-body-id="${CSS.escape(messageId)}"]`
  );
  return el instanceof HTMLElement ? el : undefined;
}

export function alignElementInContainer(
  container: HTMLElement,
  element: HTMLElement,
  align: ScrollAlign,
  behavior: ScrollBehavior = 'auto'
): void {
  const nativeBehavior: ScrollBehavior =
    behavior === 'instant' ? 'auto' : behavior;
  container.scrollBy({
    top: alignmentDelta(container, element, align),
    behavior: nativeBehavior,
  });
}

/**
 * Scrolls to a message by its ID within a messages container
 * @param messageId - The db_id of the message to scroll to
 * @param messages - Array of messages in the current thread
 * @param messagesContainer - The DOM container holding the message elements
 * @param behavior - Scroll behavior ('smooth' | 'instant' | 'auto')
 * @returns true if message was found and scrolled to, false otherwise
 */
export function scrollToMessage(
  messageId: string,
  messages: Array<{ db_id?: string | null }>,
  messagesContainer: HTMLElement,
  {
    behavior = 'smooth',
    align = 'start',
  }: {
    behavior?: ScrollBehavior;
    align?: ScrollAlign;
  } = {}
): boolean {
  const targetElement = messageElement(messagesContainer, messages, messageId);
  if (!targetElement) return false;

  alignElementInContainer(messagesContainer, targetElement, align, behavior);
  return true;
}
