function getMessageElement(messageId: string) {
  return document.querySelector<HTMLElement>(
    `[data-message-id="${messageId}"]`
  );
}

function getReplyInputElement(messageId: string) {
  return document.querySelector<HTMLElement>(
    `[data-reply-input-id="${messageId}"]`
  );
}

function getChannelScrollElement(element: HTMLElement) {
  return element.closest('[data-channel-scroll]');
}

function isElementInView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
}

function scrollIntoViewIfNeeded(element: HTMLElement) {
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
 * Scrolls the channel's scroll container so the reply input is not hidden
 * behind the virtual keyboard. Call this after the keyboard has appeared and
 * its height is known. If the input's bottom edge falls within `keyboardHeight`
 * pixels of the windows bottom edge, the container is scrolled up
 * by the overlap.
 */
export function scrollReplyInputAboveKeyboard(
  messageId: string,
  keyboardHeight: number
): boolean {
  if (keyboardHeight <= 0) return false;

  const inputEl = getReplyInputElement(messageId);
  if (!inputEl) return false;

  const scrollContainer = getChannelScrollElement(inputEl);
  if (!scrollContainer) return false;

  const inputRect = inputEl.getBoundingClientRect();
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
