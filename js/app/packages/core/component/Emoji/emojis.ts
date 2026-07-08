import GithubShortcodes from 'emojibase-data/en/shortcodes/github.json';
import EmojiLib from 'emojilib';
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

// Lower tier = better match. Exact beats prefix beats word-boundary beats
// substring, and shortcodes beat keywords at every level.
function tokenScore(token: string, entry: SimpleEmoji): number {
  if (entry.shortcodes.includes(token)) {
    return 0;
  }
  if (entry.terms.includes(token)) {
    return 1;
  }
  if (entry.shortcodes.some((code) => code.startsWith(token))) {
    return 2;
  }
  if (entry.terms.some((term) => term.startsWith(token))) {
    return 3;
  }
  if (entry.shortcodes.some((code) => code.includes(`_${token}`))) {
    return 4;
  }
  if (
    entry.terms.some(
      (term) => term.includes(`_${token}`) || term.includes(` ${token}`)
    )
  ) {
    return 5;
  }
  if (entry.shortcodes.some((code) => code.includes(token))) {
    return 6;
  }
  if (entry.terms.some((term) => term.includes(token))) {
    return 7;
  }
  return -1;
}

export function searchEmojis(query: string): SimpleEmoji[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return ORDERED_EMOJI_DATA;
  }

  const joined = tokens.join('_');
  const scored: { entry: SimpleEmoji; score: number; order: number }[] = [];
  for (let order = 0; order < ORDERED_EMOJI_DATA.length; order++) {
    const entry = ORDERED_EMOJI_DATA[order];
    let score = tokenScore(joined, entry);
    if (tokens.length > 1) {
      const perToken = tokens.map((token) => tokenScore(token, entry));
      if (perToken.every((tier) => tier >= 0)) {
        const mean =
          perToken.reduce((sum, tier) => sum + tier, 0) / tokens.length;
        if (score < 0 || mean < score) {
          score = mean;
        }
      }
    }
    if (score >= 0) {
      scored.push({ entry, score, order });
    }
  }

  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.map(({ entry }) => entry);
}

export const useEmojiData = () => {
  const [query, setQuery] = createSignal('');

  const emojis = createMemo(() => {
    if (!query() || query().trim().length <= 1) {
      return ORDERED_EMOJI_DATA;
    }

    return searchEmojis(query());
  });

  return {
    groups: EMOJI_DATA_GROUPED,
    emojis,
    filter: (query: string) => {
      setQuery(query);
    },
  };
};
