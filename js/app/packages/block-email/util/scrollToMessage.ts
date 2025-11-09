import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';

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
  messages: MessageWithBodyReplyless[],
  messagesContainer: HTMLDivElement,
  behavior: ScrollBehavior = 'smooth'
): boolean {
  const messageIndex = messages.findIndex((m) => m.db_id === messageId);

  if (messageIndex < 0) {
    return false;
  }

  const targetElement = messagesContainer.children[messageIndex];

  if (!targetElement) {
    return false;
  }

  targetElement.scrollIntoView({
    behavior,
    block: 'start',
  });

  return true;
}

/**
 * Scrolls to the last message in the thread
 * @param messagesContainer - The DOM container holding the message elements
 * @param behavior - Scroll behavior ('smooth' | 'instant' | 'auto')
 */
export function scrollToLastMessage(
  messagesContainer: HTMLDivElement,
  behavior: ScrollBehavior | 'instant' = 'instant'
): void {
  const nativeBehavior: ScrollBehavior =
    behavior === 'instant' ? 'auto' : behavior;
  const lastChild = messagesContainer.children[
    messagesContainer.children.length - 1
  ] as HTMLElement | undefined;

  if (!lastChild) return;
  // Align the last child to the bottom of the nearest scrolling container
  lastChild.scrollIntoView({ behavior: nativeBehavior, block: 'start' });
}

/**
 * Gets the last message ID from a thread
 * @param messages - Array of messages in the current thread
 * @returns The db_id of the last message, or undefined if no messages
 */
export function getLastMessageId(
  messages: MessageWithBodyReplyless[]
): string | undefined {
  const lastMessage = messages[messages.length - 1];
  return lastMessage?.db_id?.toString();
}
