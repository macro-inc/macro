import type { ReplyType } from '@app/features/email-compose/core/reply-type';
import type { EmailMessage } from '@app/features/email-message/core/email-message';

import type { Setter } from 'solid-js';
import type { EmailThreadState } from './email-thread-state';

export function openEmailReplyComposerForMessage(args: {
  ctx: EmailThreadState;
  /** Touch layouts reply in the compose drawer; the inline reply input only
   * renders for non-touch. Phone width alone is not the gate: tablets are
   * touch at desktop widths. */
  isTouch: boolean;
  message: EmailMessage;
  replyType: ReplyType;
  isLastMessage?: boolean;
  setShowReply?: Setter<boolean>;
  openReplyComposer?: (args: {
    threadId: string;
    messageId: string;
    replyType: ReplyType;
  }) => void;
}) {
  const messageId = args.message.db_id;
  if (!messageId) return false;

  const threadId = args.message.thread_db_id;

  // Open the fullscreen reply composer if the callback is provided
  if (args.openReplyComposer && threadId) {
    args.openReplyComposer({
      threadId,
      messageId,
      replyType: args.replyType,
    });
    return true;
  }

  // Fallback to inline composer behavior if no openReplyComposer callback
  args.ctx.replyRequest.set(messageId, args.replyType);

  if (args.isTouch) {
    args.ctx.mobileReplyComposer.openForMessage(messageId);
    return true;
  }

  if (args.setShowReply) {
    args.setShowReply(true);
    return true;
  }

  if (args.isLastMessage) {
    args.ctx.messages.setBottomReplyOpen(true);
  } else {
    args.ctx.messages.setExpandedBodyId(messageId, true);
    args.ctx.messages.setFocused(messageId);
    args.ctx.messages.setReplyingToMessageId(messageId);
  }

  return true;
}
