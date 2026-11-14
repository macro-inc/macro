/** Persistence, `data-input-id`, and markdown-namespace key for a thread reply composer. */
export function threadReplyInputId(threadId: string): string {
  return `thread-reply-input-${threadId}`;
}

/** The reply composer's editable, once it has mounted. */
export function queryThreadReplyEditor(threadId: string): HTMLElement | null {
  return document.querySelector(
    `[data-input-id="${threadReplyInputId(threadId)}"] [contenteditable]`
  );
}
