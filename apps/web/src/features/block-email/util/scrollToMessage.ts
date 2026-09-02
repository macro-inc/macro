import { match } from 'ts-pattern';

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

export function hiddenMessagesControl(
  container: HTMLElement
): HTMLButtonElement | undefined {
  const el = container.querySelector('[data-hidden-messages]');
  return el instanceof HTMLButtonElement ? el : undefined;
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

function scrollportRect(container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const height = container.clientHeight || rect.height;
  const width = container.clientWidth || rect.width;
  const top = rect.top + container.clientTop;
  const left = rect.left + container.clientLeft;
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    height,
    width,
  };
}

function scrollPaddingInset(
  container: HTMLElement,
  edge: 'top' | 'bottom'
): number {
  const style = getComputedStyle(container);
  return (
    parseFloat(
      edge === 'top' ? style.scrollPaddingTop : style.scrollPaddingBottom
    ) || 0
  );
}

/** Respect system motion settings for programmatic list scroll. */
export function listScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined') return 'auto';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

export function alignmentDelta(
  container: HTMLElement,
  element: HTMLElement,
  align: ScrollAlign
): number {
  const port = scrollportRect(container);
  const elementBox = element.getBoundingClientRect();
  return match(align)
    .with('end', () => {
      const inset = scrollPaddingInset(container, 'bottom');
      return elementBox.bottom - port.bottom + inset;
    })
    .with('start', () => {
      const inset = scrollPaddingInset(container, 'top');
      return elementBox.top - port.top - inset;
    })
    .with('nearest', () => nearestDelta(container, element))
    .exhaustive();
}

/** Native scroll-into-view so the list scroll-padding keeps focus rings in view. */
export function scrollFocusedCardIntoView(element: HTMLElement): void {
  element.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: listScrollBehavior(),
  });
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
  behavior: ScrollBehavior = listScrollBehavior()
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
  const port = scrollportRect(container);
  const elementBox = element.getBoundingClientRect();
  const topInset = scrollPaddingInset(container, 'top');
  const bottomInset = scrollPaddingInset(container, 'bottom');
  if (elementBox.top < port.top + topInset - 1) {
    return alignmentDelta(container, element, 'start');
  }
  if (elementBox.bottom <= port.top + topInset + 1) {
    return alignmentDelta(container, element, 'start');
  }
  if (elementBox.top >= port.bottom - bottomInset - 1) {
    return alignmentDelta(container, element, 'end');
  }
  return 0;
}

/** Keep a card in view after it grows. Prefer scrolling down. */
export function revealDelta(
  container: HTMLElement,
  element: HTMLElement
): number {
  const port = scrollportRect(container);
  const elementBox = element.getBoundingClientRect();
  if (elementBox.height >= port.height) {
    return alignmentDelta(container, element, 'start');
  }
  if (elementBox.top < port.top) {
    return alignmentDelta(container, element, 'start');
  }
  if (elementBox.bottom > port.bottom) {
    return alignmentDelta(container, element, 'end');
  }
  return 0;
}

/** Scroll a partially visible short card into view before paging or advancing. */
export function keyboardRevealDelta(
  container: HTMLElement,
  element: HTMLElement,
  dir: NavDirection
): number {
  const port = scrollportRect(container);
  const elementBox = element.getBoundingClientRect();
  const topInset = scrollPaddingInset(container, 'top');
  const bottomInset = scrollPaddingInset(container, 'bottom');
  const fitsInPort = elementBox.height <= port.height;

  // Tall cards page in place; snapping them would fight keyboard paging.
  if (!fitsInPort) return 0;

  if (dir === 'next') {
    if (elementBox.top < port.top + topInset - 1) {
      return alignmentDelta(container, element, 'start');
    }
    if (elementBox.bottom > port.bottom - bottomInset + 1) {
      return alignmentDelta(container, element, 'end');
    }
    return 0;
  }

  if (elementBox.bottom > port.bottom - bottomInset + 1) {
    return alignmentDelta(container, element, 'end');
  }
  if (elementBox.top < port.top + topInset - 1) {
    return alignmentDelta(container, element, 'start');
  }
  return 0;
}

/** Page the focused card if it still overflows. 0 means advance to the next card. */
export function pageThenAdvanceDelta(
  container: HTMLElement,
  element: HTMLElement,
  dir: NavDirection
): number {
  const port = scrollportRect(container);
  const elementBox = element.getBoundingClientRect();
  const page = port.height;
  return match(dir)
    .with('next', () => {
      const overflow = elementBox.bottom - port.bottom;
      if (overflow <= 1) return 0;
      return Math.min(overflow, page);
    })
    .with('prev', () => {
      const topInset = scrollPaddingInset(container, 'top');
      const overflow = port.top + topInset - elementBox.top;
      if (overflow <= 1) return 0;
      return -Math.min(overflow, page);
    })
    .exhaustive();
}

/** Remaining scroll to the thread title. 0 means the list is already at the top. */
export function scrollToListStartDelta(container: HTMLElement): number {
  return container.scrollTop > 1 ? -container.scrollTop : 0;
}

/** Remaining scroll to the list bottom. 0 means the list is already at the end. */
export function scrollToListEndDelta(container: HTMLElement): number {
  const maxScroll = container.scrollHeight - container.clientHeight;
  const remaining = maxScroll - container.scrollTop;
  return remaining > 1 ? remaining : 0;
}

/** Leading-edge throttle for repeated keyboard scroll steps. */
export function leadingThrottle(intervalMs: number): () => boolean {
  let lastAt = -Infinity;
  return () => {
    const now = Date.now();
    if (now - lastAt < intervalMs) return false;
    lastAt = now;
    return true;
  };
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
  const delta = container.scrollHeight - previousScrollHeight;
  if (delta <= 0) return;
  if (previousScrollTop <= 0) return;
  container.scrollTop = previousScrollTop + delta;
}

export function listNeedsOlderPage(args: {
  initialLoadComplete: boolean;
  isScrollingToMessage: boolean;
  isFetching: boolean;
  hasMore: boolean;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  if (!args.initialLoadComplete || args.isScrollingToMessage) return false;
  if (args.isFetching || !args.hasMore) return false;
  return args.scrollHeight <= args.clientHeight;
}

export async function fetchOlderMessages(
  list: HTMLElement,
  fetchNextPage: () => unknown
): Promise<void> {
  const previousScrollHeight = list.scrollHeight;
  try {
    await fetchNextPage();
    requestAnimationFrame(() => {
      adjustScrollAfterPrepend(list, previousScrollHeight, list.scrollTop);
    });
  } catch {
    return;
  }
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
