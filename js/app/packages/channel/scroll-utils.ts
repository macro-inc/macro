function getMessageElement(messageId: string) {
  return document.querySelector<HTMLElement>(
    `[data-message-id="${messageId}"]`
  );
}

function getReplyInputElement(messageId: string) {
  return document.querySelector<HTMLElement>(
    `[data-inline-input-container-id="${messageId}"]`
  );
}

function getChannelScrollElement(element: HTMLElement) {
  return element.closest('[data-channel-scroll]');
}

function isElementInView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
}

export function scrollIntoViewIfNeeded(element: HTMLElement) {
  if (isElementInView(element)) return false;
  element.scrollIntoView({ block: 'nearest' });
  return true;
}

export function isMessageInView(messageId: string) {
  const element = getMessageElement(messageId);
  return !!element && isElementInView(element);
}

export function scrollMessageIntoView(messageId: string) {
  const element = getMessageElement(messageId);
  if (!element) return false;
  return scrollIntoViewIfNeeded(element);
}

export function isReplyInputInView(messageId: string) {
  const element = getReplyInputElement(messageId);
  return !!element && isElementInView(element);
}

export function scrollReplyInputIntoView(messageId: string) {
  const element = getReplyInputElement(messageId);
  if (!element) return false;
  return scrollIntoViewIfNeeded(element);
}

/**
 * Scrolls the channel's scroll container so the given element is not hidden
 * behind the virtual keyboard. Call this after the keyboard has appeared and
 * its height is known.
 */
export function scrollElementAboveKeyboard(
  el: HTMLElement,
  keyboardHeight: number
): boolean {
  if (keyboardHeight <= 0) return false;

  const scrollContainer = getChannelScrollElement(el);
  if (!scrollContainer) return false;

  const inputRect = el.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  // The keyboard rises from the bottom of the screen, so the visible bottom of
  // the scroll container is capped at (screen bottom - keyboard height).
  const visibleBottom = Math.min(
    containerRect.bottom,
    window.innerHeight - keyboardHeight
  );

  const SCROLL_OFFSET = 8;

  if (inputRect.bottom > visibleBottom - SCROLL_OFFSET) {
    scrollContainer.scrollTop +=
      inputRect.bottom - visibleBottom + SCROLL_OFFSET;
    return true;
  }
  return false;
}
