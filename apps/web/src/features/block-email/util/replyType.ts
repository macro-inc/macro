import type { ApiMessage } from '@service-email/generated/schemas';

export type ReplyType = 'reply' | 'reply-all' | 'forward';

export const getReplyTypeFromDraft: (
  draft: ApiMessage | undefined
) => ReplyType | undefined = (draft: ApiMessage | undefined) => {
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
