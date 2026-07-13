import CompactEmojiData from 'emojibase-data/en/compact.json';
import OrderedEmojiData from 'unicode-emoji-json/data-ordered-emoji.json';

// Emits a slim hexcode-to-tags map for emoji search so the app bundles CLDR
// keyword annotations without the rest of the emojibase dataset. Keys are
// FE0F insensitive to match the join in src/lib/core/component/Emoji/emojis.ts.
// Rerun with `bun run gen-emoji-tags` after bumping emojibase-data.

const OUTPUT_PATH = new URL(
  '../src/lib/core/component/Emoji/cldr-tags.json',
  import.meta.url
).pathname;

function fe0fInsensitiveKey(codepoints: string[]): string {
  return codepoints.filter((hex) => hex !== 'FE0F').join('-');
}

function emojiKey(emoji: string): string {
  return fe0fInsensitiveKey(
    [...emoji].map(
      (char) => char.codePointAt(0)?.toString(16).toUpperCase() ?? ''
    )
  );
}

const tagsByKey = new Map<string, string[]>();
for (const entry of CompactEmojiData) {
  if (!entry.tags?.length) {
    continue;
  }
  tagsByKey.set(
    fe0fInsensitiveKey(entry.hexcode.split('-')),
    [...new Set(entry.tags.map((tag) => tag.toLowerCase()))].sort()
  );
}

const output: Record<string, string[]> = {};
let missing = 0;
for (const emoji of OrderedEmojiData) {
  const key = emojiKey(emoji);
  const tags = tagsByKey.get(key);
  if (tags) {
    output[key] = tags;
  } else {
    missing++;
  }
}

await Bun.write(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `Wrote ${Object.keys(output).length} entries to ${OUTPUT_PATH} (${missing} emojis without tags)`
);
