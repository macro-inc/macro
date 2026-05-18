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

export function scrollMessageIntoView(messageId: string) {
  const element = getMessageElement(messageId);
  if (!element) return false;
  element.scrollIntoView({ block: 'nearest' });
  return true;
}

export function scrollReplyInputIntoView(messageId: string) {
  const element = getReplyInputElement(messageId);
  if (!element) return false;
  element.scrollIntoView({ block: 'nearest' });
  return true;
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
