function getMessageElement(messageId: string) {
  return document.querySelector<HTMLElement>(
    `[data-message-id="${messageId}"]`
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

/**
 * Scrolls the channel's scroll container so the given element is not hidden
 * behind whatever covers the bottom of the screen — the virtual keyboard
 * plus any chrome floating on top of it (e.g. the unified input). Call this
 * after the keyboard has appeared and its height is known.
 */
export function scrollElementAboveObstruction(
  el: HTMLElement,
  obstructionHeight: number
): boolean {
  if (obstructionHeight <= 0) return false;

  const scrollContainer = getChannelScrollElement(el);
  if (!scrollContainer) return false;

  const elRect = el.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  // The obstruction rises from the bottom of the screen, so the visible
  // bottom of the scroll container is capped at (screen bottom - obstruction).
  const visibleBottom = Math.min(
    containerRect.bottom,
    window.innerHeight - obstructionHeight
  );

  const SCROLL_OFFSET = 8;

  if (elRect.bottom > visibleBottom - SCROLL_OFFSET) {
    scrollContainer.scrollTop += elRect.bottom - visibleBottom + SCROLL_OFFSET;
    return true;
  }
  return false;
}

/** `scrollElementAboveKeyboard` for a message row, looked up by id. */
export function scrollMessageAboveKeyboard(
  messageId: string,
  obstructionHeight: number
): boolean {
  const element = getMessageElement(messageId);
  if (!element) return false;
  return scrollElementAboveObstruction(element, obstructionHeight);
}
