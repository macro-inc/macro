import GithubShortcodes from 'emojibase-data/en/shortcodes/github.json';
import EmojiLib from 'emojilib';
import Fuse from 'fuse.js';
import { createMemo, createSignal } from 'solid-js';
import GroupedEmojiData from 'unicode-emoji-json/data-by-group.json';
import OrderedEmojiData from 'unicode-emoji-json/data-ordered-emoji.json';

export type SimpleEmoji = {
  emoji: string;
  slug: string;
  shortcodes: string[];
  terms: string[];
};

// emojibase appends FE0F variation selectors where unicode-emoji-json (and our
// stored reactions) use the bare canonical form, so both sides of the shortcode
// join drop FE0F. Emitted emoji strings always come from unicode-emoji-json.
function fe0fInsensitiveKey(codepoints: string[]): string {
  return codepoints.filter((hex) => hex !== 'FE0F').join('-');
}

const SHORTCODES_BY_KEY = new Map<string, string[]>(
  Object.entries(GithubShortcodes).map(([hexcode, codes]) => [
    fe0fInsensitiveKey(hexcode.split('-')),
    Array.isArray(codes) ? codes : [codes],
  ])
);

function emojiKey(emoji: string): string {
  return fe0fInsensitiveKey(
    [...emoji].map(
      (char) => char.codePointAt(0)?.toString(16).toUpperCase() ?? ''
    )
  );
}

function buildEmoji(emoji: string): SimpleEmoji {
  const terms = EmojiLib[emoji] ?? [];
  const github = SHORTCODES_BY_KEY.get(emojiKey(emoji));
  const shortcodes = github ?? [terms.at(0) ?? emoji];
  return { emoji, slug: shortcodes[0], shortcodes, terms };
}

const ORDERED_EMOJI_DATA: SimpleEmoji[] = OrderedEmojiData.map(buildEmoji);

const EMOJI_BY_CHAR = new Map(
  ORDERED_EMOJI_DATA.map((entry) => [entry.emoji, entry])
);

const EMOJI_DATA_GROUPED = GroupedEmojiData.map((group) => {
  return {
    name: group.name,
    emojis: group.emojis.map(
      ({ emoji }) => EMOJI_BY_CHAR.get(emoji) ?? buildEmoji(emoji)
    ),
  };
});

const EMOJI_BY_NAME = new Map<string, string>();
for (const { emoji, shortcodes } of ORDERED_EMOJI_DATA) {
  for (const name of shortcodes) {
    if (!EMOJI_BY_NAME.has(name)) {
      EMOJI_BY_NAME.set(name, emoji);
    }
  }
}

export function resolveEmoji(key: string): string | undefined {
  return EMOJI_BY_NAME.get(key.replaceAll(':', '').toLowerCase());
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
