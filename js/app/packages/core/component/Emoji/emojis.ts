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

const ALIAS_TO_EMOJI = new Map(
  Object.entries(EMOJI_ALIASES).map(([emoji, alias]) => [alias, emoji])
);

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

const ORDERED_EMOJI_BY_UNICODE = new Map(
  ORDERED_EMOJI_DATA.map((emoji) => [emoji.emoji, emoji])
);

const TERM_TO_EMOJI = new Map<string, string>();
for (const { emoji, terms } of ORDERED_EMOJI_DATA) {
  const primaryTerm = terms?.at(0);
  if (primaryTerm && !TERM_TO_EMOJI.has(primaryTerm)) {
    TERM_TO_EMOJI.set(primaryTerm, emoji);
  }
}

const emojiSearch = new Fuse(ORDERED_EMOJI_DATA, {
  keys: ['terms'],
});
const emojiSearchCache = new Map<string, SimpleEmoji[]>();
const SEARCH_CACHE_LIMIT = 128;

function searchEmojiData(query: string): SimpleEmoji[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length <= 1) {
    return ORDERED_EMOJI_DATA;
  }

  const cached = emojiSearchCache.get(normalizedQuery);
  if (cached) return cached;

  const result = emojiSearch.search(normalizedQuery).map(({ item }) => item);
  if (emojiSearchCache.size >= SEARCH_CACHE_LIMIT) {
    emojiSearchCache.clear();
  }
  emojiSearchCache.set(normalizedQuery, result);
  return result;
}

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
  return ORDERED_EMOJI_BY_UNICODE.get(emoji);
}

export function resolveEmoji(key: string): string | undefined {
  const value = key.replaceAll(':', '');

  const aliasEmoji = ALIAS_TO_EMOJI.get(value);
  if (aliasEmoji) {
    return aliasEmoji;
  }

  return TERM_TO_EMOJI.get(value);
}

export const useEmojiData = () => {
  const [query, setQuery] = createSignal('');

  const emojis = createMemo(() => searchEmojiData(query()));

  return {
    groups: EMOJI_DATA_GROUPED,
    emojis,
    filter: (query: string) => {
      const normalizedQuery = query.trim().toLowerCase();
      setQuery((prev) => (prev === normalizedQuery ? prev : normalizedQuery));
    },
  };
};
