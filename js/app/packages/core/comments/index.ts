import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import type { Signal } from 'solid-js';

export const getAndClearCommentMentions = (
  mentionsSignal: Signal<UserMentionRecord[]>
) => {
  const [mentions, setMentions] = mentionsSignal;
  const mentions_ = mentions();
  setMentions([]);
  return typeof mentions_[0] === 'undefined'
    ? undefined
    : {
        users: mentions_.flatMap((m) => m.mentions),
        mentionId: mentions_[0].metadata.mention_id,
      };
};
