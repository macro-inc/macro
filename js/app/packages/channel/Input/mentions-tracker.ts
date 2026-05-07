import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { type Accessor, createSignal } from 'solid-js';

type MentionFn = (item: ItemMention) => void;
export type MentionsTracker = {
  onMentionCreate: MentionFn;
  onMentionRemove: MentionFn;
  mentions: Accessor<ItemMention[]>;
  setMentions: (mentions: ItemMention[]) => void;
};

export function createMentionsTracker(): MentionsTracker {
  const [mentions, setMentions] = createSignal<ItemMention[]>([]);
  const onMentionRemove = (mention: ItemMention) => {
    setMentions((current) => {
      const index = current.findIndex(
        (item) =>
          item.itemType === mention.itemType && item.itemId === mention.itemId
      );
      if (index < 0) return current;
      return [...current.slice(0, index), ...current.slice(index + 1)];
    });
  };

  const onMentionCreate = (mention: ItemMention) => {
    setMentions((current) => [...current, mention]);
  };

  return {
    onMentionCreate,
    onMentionRemove,
    mentions,
    setMentions: (next) => setMentions(next),
  };
}
