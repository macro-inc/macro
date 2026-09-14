import { createCommand } from 'lexical';
import type { EmailMessage } from '../../email-message/core/email-message';
import type { ReplyType } from '../core/reply-type';
export const TOGGLE_APPEND_EMAIL_THREAD_COMMAND = createCommand<{
  replyingTo: EmailMessage | undefined;
  replyType?: ReplyType;
  visible: boolean;
  /** Whether the quoted message is personal (drives theme-adapted rendering
   * of the quoted html, matching the message view) */
  isPersonal?: boolean;
}>('TOGGLE_APPEND_EMAIL_THREAD_COMMAND');
