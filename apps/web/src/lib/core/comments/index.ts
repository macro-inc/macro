import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import type { Signal } from 'solid-js';

export const getAndClearCommentMentions = (
  mentionsSignal: Signal<UserMentionRecord[]>
) => {
  const [mentions, setMentions] = mentionsSignal;
  const mentions_ = mentions();
  setMentions([]);
  return mentions_
    .flatMap((record) => record.mentions)
    .map((id) => ({ entity_type: 'user', entity_id: id }));
};
