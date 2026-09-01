/**
 * Return selected browser text only when both ends of the selection belong to
 * the clicked message's rendered Markdown content.
 */
function getMessageContent(
  actionTarget: Element,
  messageId: string
): HTMLElement | undefined {
  const messageRoot = actionTarget.closest<HTMLElement>('[data-message]');
  if (!messageRoot || messageRoot.dataset.messageId !== messageId) {
    return undefined;
  }
  return (
    messageRoot.querySelector<HTMLElement>('[data-message-content]') ??
    undefined
  );
}

export function getSelectedMessageText(
  actionTarget: Element,
  messageId: string,
  selection: Selection | null = window.getSelection()
): string | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return undefined;
  }

  const content = getMessageContent(actionTarget, messageId);
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!content || !anchor || !focus) return undefined;
  if (!content.contains(anchor) || !content.contains(focus)) return undefined;

  const text = selection.toString().trim();
  return text || undefined;
}

/** Return decorator-provided, already-resolved text for a reply preview. */
export function getRenderedMessageReplyText(
  actionTarget: Element,
  messageId: string
): string | undefined {
  const preview = getMessageContent(actionTarget, messageId)?.querySelector(
    '[data-message-reply-preview]'
  );
  const explicitText = preview?.getAttribute('data-message-reply-preview');
  const renderedText =
    preview instanceof HTMLElement ? preview.innerText : undefined;
  const text = (explicitText || renderedText || preview?.textContent)?.trim();
  return text || undefined;
}
