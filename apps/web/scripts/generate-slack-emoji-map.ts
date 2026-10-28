import GithubShortcodes from 'emojibase-data/en/shortcodes/github.json';
import SlackShortcodes from 'emojibase-data/en/shortcodes/iamcal.json';
import EmojibasePackage from 'emojibase-data/package.json';
import OrderedEmojiData from 'unicode-emoji-json/data-ordered-emoji.json';
import UnicodePackage from 'unicode-emoji-json/package.json';

// Pinned provenance and licenses: crates/slack_integration/data/README.md.
if (
  EmojibasePackage.version !== '17.0.0' ||
  UnicodePackage.version !== '0.8.0'
) {
  throw new Error(
    'Emoji package versions changed; review the dataset and provenance'
  );
}

const outputPath = new URL(
  '../../../crates/slack_integration/data/emoji-shortcodes.json',
  import.meta.url
);

function canonicalKey(codepoints: string[]): string {
  return codepoints
    .map((hex) => Number.parseInt(hex, 16))
    .filter((point) => point !== 0xfe0f)
    .join('-');
}

const canonicalEmoji = new Map(
  OrderedEmojiData.map((emoji) => [
    canonicalKey([...emoji].map((char) => char.codePointAt(0)!.toString(16))),
    emoji,
  ])
);
const shortcodes = new Map<string, string>();
// Slack/iamcal wins conflicts (notably :email:); GitHub adds compatible aliases.
for (const source of [GithubShortcodes, SlackShortcodes]) {
  for (const [hexcode, names] of Object.entries(source)) {
    const emoji = canonicalEmoji.get(canonicalKey(hexcode.split('-')));
    if (
      !emoji ||
      [...emoji].some((char) => {
        const point = char.codePointAt(0)!;
        return point >= 0x1f3fb && point <= 0x1f3ff;
      })
    ) {
      continue;
    }
    for (const name of Array.isArray(names) ? names : [names]) {
      shortcodes.set(name, emoji);
    }
  }
}

// Stable ASCII JSON is easy to diff and does not depend on locale ordering.
const output = `${JSON.stringify(
  Object.fromEntries(
    [...shortcodes.keys()].sort().map((name) => [name, shortcodes.get(name)])
  ),
  null,
  2
).replace(
  /[\u007f-\uffff]/g,
  (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
)}\n`;

if (Bun.argv.includes('--check')) {
  if ((await Bun.file(outputPath).text()) !== output) {
    throw new Error('Stale Slack emoji map; rerun this script without --check');
  }
  console.log(`Checked ${shortcodes.size} Slack shortcodes`);
} else {
  await Bun.write(outputPath, output);
  console.log(`Wrote ${shortcodes.size} Slack shortcodes`);
}
