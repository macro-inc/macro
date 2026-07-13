import GithubShortcodes from 'emojibase-data/en/shortcodes/github.json';
import EmojiLib from 'emojilib';
import { createMemo, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import GroupedEmojiData from 'unicode-emoji-json/data-by-group.json';
import OrderedEmojiData from 'unicode-emoji-json/data-ordered-emoji.json';
import CldrTags from './cldr-tags.json';
import { emojiUsageCount, frequentEmojiChars } from './emojiUsage';

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
  const keywords = EmojiLib[emoji] ?? [];
  const github = SHORTCODES_BY_KEY.get(emojiKey(emoji));
  const shortcodes = github ?? [keywords.at(0) ?? emoji];
  const cldrTags: string[] =
    (CldrTags as Record<string, string[]>)[emojiKey(emoji)] ?? [];
  const terms = [...new Set([...keywords, ...cldrTags])];
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

// Lower tier = better match. Exact shortcode first, then one shared tier for
// exact keywords and shortcode prefixes (CLDR keywords are inconsistent
// enough that neither should dominate the other — "thumbs" is a keyword of
// thumbs_down only), then keyword prefixes, word boundaries, and substrings.
function tokenScore(token: string, entry: SimpleEmoji): number {
  return match(entry)
    .when(
      ({ shortcodes }) => shortcodes.includes(token),
      () => 0
    )
    .when(
      ({ shortcodes, terms }) =>
        terms.includes(token) ||
        shortcodes.some((code) => code.startsWith(token)),
      () => 1
    )
    .when(
      ({ terms }) => terms.some((term) => term.startsWith(token)),
      () => 2
    )
    .when(
      ({ shortcodes }) => shortcodes.some((code) => code.includes(`_${token}`)),
      () => 3
    )
    .when(
      ({ terms }) =>
        terms.some(
          (term) => term.includes(`_${token}`) || term.includes(` ${token}`)
        ),
      () => 4
    )
    .when(
      ({ shortcodes }) => shortcodes.some((code) => code.includes(token)),
      () => 5
    )
    .when(
      ({ terms }) => terms.some((term) => term.includes(token)),
      () => 6
    )
    .otherwise(() => -1);
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
  const scored: {
    entry: SimpleEmoji;
    score: number;
    usage: number;
    order: number;
  }[] = [];
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
      scored.push({ entry, score, usage: emojiUsageCount(entry.emoji), order });
    }
  }

  // Usage only breaks ties within a match tier, so exact matches stay on top
  // no matter how often another emoji is picked.
  scored.sort(
    (a, b) => a.score - b.score || b.usage - a.usage || a.order - b.order
  );
  return scored.map(({ entry }) => entry);
}

const FREQUENT_EMOJI_LIMIT = 12;

function frequentEmojis(): SimpleEmoji[] {
  return frequentEmojiChars(FREQUENT_EMOJI_LIMIT)
    .map((emoji) => EMOJI_BY_CHAR.get(emoji))
    .filter((entry): entry is SimpleEmoji => entry !== undefined);
}

export const useEmojiData = () => {
  const [query, setQuery] = createSignal('');

  const emojis = createMemo(() => {
    if (!query() || query().trim().length <= 1) {
      const frequent = frequentEmojis();
      if (frequent.length === 0) {
        return ORDERED_EMOJI_DATA;
      }
      const frequentSet = new Set(frequent.map(({ emoji }) => emoji));
      return [
        ...frequent,
        ...ORDERED_EMOJI_DATA.filter(({ emoji }) => !frequentSet.has(emoji)),
      ];
    }

    return searchEmojis(query());
  });

  const groups = createMemo(() => {
    const frequent = frequentEmojis();
    if (frequent.length === 0) {
      return EMOJI_DATA_GROUPED;
    }
    return [
      { name: 'Frequently used', emojis: frequent },
      ...EMOJI_DATA_GROUPED,
    ];
  });

  return {
    groups,
    emojis,
    filter: (query: string) => {
      setQuery(query);
    },
  };
};
