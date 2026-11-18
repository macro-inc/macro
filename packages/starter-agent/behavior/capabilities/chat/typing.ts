/**
 * Shows the agent typing while it works on a reply, until the reply posts:
 * one indicator per channel, replaced by the next reply's. It is muppet's
 * `typingOn`, on the process's one `typingIndicators` (chat's context), so
 * stopping a reply's never ends another's (the greeting's).
 */
export {
  type Typing,
  typingOn as typing,
} from '@macro-inc/muppet/utilities/macro/chat';
