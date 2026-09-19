import type { ReplyType } from '@app/features/email-compose/core/reply-type';
import type { EmailMessage } from '@app/features/email-message/core/email-message';

import type { Setter } from 'solid-js';
import type { EmailThreadState } from './email-thread-state';

export function openEmailReplyComposerForMessage(args: {
  ctx: EmailThreadState;
  isMobile: boolean;
  message: EmailMessage;
  replyType: ReplyType;
  isLastMessage?: boolean;
  setShowReply?: Setter<boolean>;
}) {
  const messageId = args.message.db_id;
  if (!messageId) return false;

  // The reply type and focus land through the reply request: the mounted
  // composer's effect applies them to its own (seed-keyed) form instance.
  // Writing to the form registry from here would target the wrong entry —
  // the registry key includes a seed only the composer knows.
  args.ctx.replyRequest.set(messageId, args.replyType);

  if (args.isMobile) {
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
