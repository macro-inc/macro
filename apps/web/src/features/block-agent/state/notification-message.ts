/**
 * Telling an event notification apart from a prompt.
 *
 * A Cursor run that subscribes to something outside the conversation — a CI
 * run, a thread, a timer — gets told about it by a prompt Cursor writes
 * itself, wrapped in `<system_notification …>` (see `SystemNotificationNode`
 * in lexical-core). The fold records it as a user message like any other, so
 * by author it is indistinguishable from something a person typed. It is
 * not: nobody sent it, so it should not sit in a prompt bubble under
 * someone's name.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';

const NOTIFICATION_ONLY =
  /^\s*<system_notification\b[^>]*>[\s\S]*?<\/system_notification>\s*$/;

/**
 * Every part is a notification Cursor wrote: the message is an event, not a
 * prompt. A prompt a person typed around a pasted notification stays theirs.
 */
export function isNotificationMessage(message: FoldedMessage): boolean {
  if (message.author.kind !== 'user' || message.parts.length === 0) {
    return false;
  }
  return message.parts.every(
    (part) => part.kind === 'text' && NOTIFICATION_ONLY.test(part.text)
  );
}
