import { isMobile } from '@core/mobile/isMobile';
import type { ApiMessage } from '@service-email/generated/schemas';
import type { Setter } from 'solid-js';
import type { ReplyType } from '../util/replyType';
import type { useEmailContext } from './EmailContext';
import type { getEmailFormRegistry } from './EmailFormContext';

export function openEmailReplyComposerForMessage(args: {
  ctx: ReturnType<typeof useEmailContext>;
  formRegistry?: ReturnType<typeof getEmailFormRegistry>;
  message: ApiMessage;
  replyType: ReplyType;
  isLastMessage?: boolean;
  setShowReply?: Setter<boolean>;
}) {
  const messageId = args.message.db_id;
  if (!messageId) return false;

  args.ctx.replyRequest.set(messageId, args.replyType);

  if (args.formRegistry) {
    const form = args.formRegistry.getOrInit({
      type: 'replying_to',
      messageID: messageId,
    });
    form.setReplyType(args.replyType);
    form.setShouldFocusInput(true);
  }

  if (isMobile()) {
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
