export type ScrollAlign = 'start' | 'end' | 'nearest';
export type NavDirection = 'prev' | 'next';

export type OpenTargetMessage = {
  db_id?: string | null;
  labels: Array<{ provider_label_id?: string | null }>;
};

export function isUnreadMessage(message: OpenTargetMessage): boolean {
  return message.labels.some((label) => label.provider_label_id === 'UNREAD');
}

/** Oldest, penultimate, and newest stay visible. Hide the rest when length > 3. */
export function isTruncatedMiddleMessage(
  chronologicalIndex: number,
  length: number
): boolean {
  return (
    length > 3 && chronologicalIndex > 0 && chronologicalIndex < length - 2
  );
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
    case 'nearest':
      return nearestDelta(container, element);
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
  if (!messages.some((message) => message.db_id === messageId))
    return undefined;
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

/** Scroll only if the card does not intersect the viewport. */
export function nearestDelta(
  container: HTMLElement,
  element: HTMLElement
): number {
  const containerBox = container.getBoundingClientRect();
  const elementBox = element.getBoundingClientRect();
  if (elementBox.bottom <= containerBox.top + 1) {
    return alignmentDelta(container, element, 'start');
  }
  if (elementBox.top >= containerBox.bottom - 1) {
    return alignmentDelta(container, element, 'end');
  }
  return 0;
}

/** Keep a card in view after it grows. Prefer scrolling down. */
export function revealDelta(
  container: HTMLElement,
  element: HTMLElement
): number {
  const containerBox = container.getBoundingClientRect();
  const elementBox = element.getBoundingClientRect();
  if (elementBox.height >= containerBox.height) {
    return alignmentDelta(container, element, 'start');
  }
  if (elementBox.top < containerBox.top) {
    return alignmentDelta(container, element, 'start');
  }
  if (elementBox.bottom > containerBox.bottom) {
    return alignmentDelta(container, element, 'end');
  }
  return 0;
}

/** Page the focused card if it still overflows. 0 means advance to the next card. */
export function pageThenAdvanceDelta(
  container: HTMLElement,
  element: HTMLElement,
  dir: NavDirection
): number {
  const containerBox = container.getBoundingClientRect();
  const elementBox = element.getBoundingClientRect();
  const page = containerBox.height;
  switch (dir) {
    case 'next': {
      const overflow = elementBox.bottom - containerBox.bottom;
      if (overflow <= 1) return 0;
      return Math.min(overflow, page);
    }
    case 'prev': {
      const overflow = containerBox.top - elementBox.top;
      if (overflow <= 1) return 0;
      return -Math.min(overflow, page);
    }
    default: {
      const _exhaustive: never = dir;
      return _exhaustive;
    }
  }
}

export function revealMessageInView(
  messageId: string,
  messages: Array<{ db_id?: string | null }>,
  container: HTMLElement,
  behavior: ScrollBehavior = 'smooth'
): void {
  const element = messageElement(container, messages, messageId);
  if (!element) return;
  const top = revealDelta(container, element);
  if (top === 0) return;
  const nativeBehavior: ScrollBehavior =
    behavior === 'instant' ? 'auto' : behavior;
  container.scrollBy({ top, behavior: nativeBehavior });
}

/** Older pages insert above. Keep the card you were reading on screen. */
export function adjustScrollAfterPrepend(
  container: HTMLElement,
  previousScrollHeight: number,
  previousScrollTop: number
): void {
  if (previousScrollTop <= 0) return;
  const delta = container.scrollHeight - previousScrollHeight;
  if (delta > 0) container.scrollTop = previousScrollTop + delta;
}

export function revealMessageAfterLayout(
  messageId: string,
  messages: Array<{ db_id?: string | null }>,
  container: HTMLElement | undefined | null,
  behavior: ScrollBehavior = 'smooth'
): void {
  if (!container) return;
  requestAnimationFrame(() => {
    revealMessageInView(messageId, messages, container, behavior);
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
