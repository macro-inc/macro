import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';

export type ReplyType = 'reply' | 'reply-all' | 'forward';

export const getReplyTypeFromDraft: (
  draft: MessageWithBodyReplyless | undefined
) => ReplyType | undefined = (draft: MessageWithBodyReplyless | undefined) => {
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
