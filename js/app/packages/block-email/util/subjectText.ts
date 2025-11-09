import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import type { ReplyType } from './replyType';

export const getSubjectText = (
  replyingTo: MessageWithBodyReplyless | undefined,
  replyType: ReplyType | undefined
) => {
  if (!replyingTo) return '';
  if (replyType === 'reply-all' || replyType === 'reply') {
    if (replyingTo.subject?.includes('Re: ')) {
      return replyingTo.subject;
    } else {
      return `Re: ${replyingTo.subject}`;
    }
  } else if (replyType === 'forward') {
    return `Fwd: ${replyingTo.subject}`;
  } else {
    return replyingTo.subject ?? '';
  }
};
