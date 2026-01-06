import type { UserMentionRecord } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import type { Signal } from 'solid-js';

export const getCommentMentions = (
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
