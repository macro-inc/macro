import EmojiLib from 'emojilib';
import Fuse from 'fuse.js';
import { createMemo, createSignal } from 'solid-js';
import GroupedEmojiData from 'unicode-emoji-json/data-by-group.json';
import OrderedEmojiData from 'unicode-emoji-json/data-ordered-emoji.json';

export type SimpleEmoji = {
  emoji: string;
  slug: string;
  terms: string[];
};

/** custom aliases to make commonly used emojis easier to find */
const EMOJI_ALIASES: Record<string, string> = {
  '😀': 'smile',
  '😃': 'laughing',
  '😂': 'joy',
  // unicode for the heart emoji is kind of stupid, need to write it like this
  [String.fromCodePoint(0x2764, 0xfe0f)]: 'heart',
};

function resolveEmojiSlug(emoji: string): string | undefined {
  if (EMOJI_ALIASES[emoji]) {
    return EMOJI_ALIASES[emoji];
  }
  return EmojiLib[emoji]?.at(0);
}

function resolveEmojiTerms(emoji: string): string[] {
  return EmojiLib[emoji] ?? [];
}

export const ORDERED_EMOJI_DATA: SimpleEmoji[] = OrderedEmojiData.map(
  (emoji) => {
    return {
      emoji: emoji,
      slug: resolveEmojiSlug(emoji) ?? emoji,
      terms: resolveEmojiTerms(emoji),
    };
  }
);

export const EMOJI_DATA_GROUPED = GroupedEmojiData.map((group) => {
  return {
    name: group.name,
    emojis: group.emojis.map((emoji) => {
      return {
        emoji: emoji.emoji,
        slug: resolveEmojiSlug(emoji.slug) ?? emoji.slug,
        terms: resolveEmojiTerms(emoji.slug),
      };
    }),
  };
});

export function resolveEmojiFromUnicode(
  emoji: string
): SimpleEmoji | undefined {
  return ORDERED_EMOJI_DATA.find(({ emoji: emoji_ }) => emoji_ === emoji);
}

export function resolveEmoji(key: string): string | undefined {
  const value = key.replaceAll(':', '');

  if (Object.values(EMOJI_ALIASES).includes(value)) {
    const found = Object.entries(EMOJI_ALIASES).find(
      ([_, alias]) => alias === value
    );

    if (found) {
      return found[0];
    }
  }

  const found = ORDERED_EMOJI_DATA.find(({ terms }) => terms?.at(0) === value);

  return found?.emoji;
}

export const useEmojiData = () => {
  const [query, setQuery] = createSignal('');

  const fuse = new Fuse(ORDERED_EMOJI_DATA, {
    keys: ['terms'],
  });

  const emojis = createMemo(() => {
    if (!query() || query().trim().length <= 1) {
      return ORDERED_EMOJI_DATA;
    }

    const result = fuse.search(query());
    const ret = result.map(({ item }) => item);
    return ret;
  });

  return {
    groups: EMOJI_DATA_GROUPED,
    emojis,
    filter: (query: string) => {
      setQuery(query);
    },
  };
};
