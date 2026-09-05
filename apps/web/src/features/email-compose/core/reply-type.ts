import type { EmailMessage } from '@app/features/email-message/core/email-message';

export type ReplyType = 'reply' | 'reply-all' | 'forward';

export const getReplyTypeFromDraft: (
  draft: EmailMessage | undefined
) => ReplyType | undefined = (draft: EmailMessage | undefined) => {
  if (!draft) {
    return undefined;
  }

  if (draft.subject?.toLowerCase().startsWith('fwd: ')) {
    return 'forward';
  } else if (draft.to.length + draft.cc.length > 1) {
    return 'reply-all';
  } else {
    return 'reply';
  }
};
