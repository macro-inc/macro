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
