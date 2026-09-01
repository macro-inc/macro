/**
 * Return selected browser text only when both ends of the selection belong to
 * the clicked message's rendered Markdown content.
 */
export function getSelectedMessageText(
  actionTarget: Element,
  messageId: string,
  selection: Selection | null = window.getSelection()
): string | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return undefined;
  }

  const messageRoot = actionTarget.closest<HTMLElement>('[data-message]');
  if (!messageRoot || messageRoot.dataset.messageId !== messageId) {
    return undefined;
  }

  const content = messageRoot.querySelector<HTMLElement>(
    '[data-message-content]'
  );
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!content || !anchor || !focus) return undefined;
  if (!content.contains(anchor) || !content.contains(focus)) return undefined;

  const text = selection.toString().trim();
  return text || undefined;
}
