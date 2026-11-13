/**
 * GitHub-flavored Markdown as GitHub renders it — comments, PR descriptions,
 * bot reviews (CodeRabbit, Dependabot, Copilot) — mixes Markdown with raw
 * HTML that our importer would otherwise show literally. This rewrites that
 * HTML into the Markdown our transformers read, keeping `<details>` for the
 * details transformer (`transformers/details.ts`), so a comment reads the way
 * it does on GitHub. Fenced code and code spans are left untouched.
 */

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const PLACEHOLDER = (index: number) => `\uE000${index}\uE001`;
const PLACEHOLDER_PATTERN = /\uE000(\d+)\uE001/g;
/** Marks where a decorative image was dropped, so its spacing goes with it. */
const DROPPED = '\uE002';

/** Images this small are icons: GitHub draws them inline beside text. */
const ICON_MAX_PX = 32;
/** Hosts whose images are decorative badges, never content. */
const DECORATIVE_IMAGE_HOSTS = [
  'storage.googleapis.com/coderabbit_public_assets/',
  'img.shields.io/',
];

const ATTRIBUTE_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

const ALERT_LABELS: Record<string, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};

/** Tags that only group blocks; each becomes a paragraph break. */
const BLOCK_WRAPPER_TAGS =
  'dl|dd|dt|div|p|center|section|article|header|footer|figure|figcaption|ul|ol|table|thead|tbody|tfoot|h[1-6]';
/** Tags that only style or group inline text, without a Markdown equivalent. */
const INLINE_WRAPPER_TAGS =
  'span|small|big|font|abbr|cite|dfn|var|mark|picture|source';

function decodeAttribute(value: string): string {
  return value.replace(
    /&(?:amp|quot|#39|apos|lt|gt);/g,
    (entity) => ATTRIBUTE_ENTITIES[entity] ?? entity
  );
}

function attribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp(
      `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      'i'
    )
  );
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeAttribute(value);
}

function isDecorativeSource(src: string): boolean {
  return DECORATIVE_IMAGE_HOSTS.some((host) => src.includes(host));
}

function isIconSized(attributes: string): boolean {
  return ['width', 'height'].some((name) => {
    const value = Number.parseInt(attribute(attributes, name) ?? '', 10);
    return Number.isFinite(value) && value <= ICON_MAX_PX;
  });
}

function escapeLinkText(text: string): string {
  return text.replace(/[[\]]/g, '\\$&');
}

function escapeUrl(url: string): string {
  return url.replace(/[\s()]/g, encodeURIComponent);
}

/** An `<img>` as Markdown: its alt text when it is an icon, else an image. */
function imageTag(attributes: string): string {
  const src = attribute(attributes, 'src');
  const alt = attribute(attributes, 'alt')?.trim() ?? '';
  if (!src || isDecorativeSource(src) || isIconSized(attributes)) {
    return alt || DROPPED;
  }
  return `![${escapeLinkText(alt)}](${escapeUrl(src)})`;
}

/**
 * Our image transformer reads only an image on a line of its own, so an image
 * among other text becomes its alt text (a badge) or a link to it.
 */
function inlineImages(line: string): string {
  const imageOnly = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line);
  return line.replace(
    /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    (image, alt: string, src: string) => {
      if (isDecorativeSource(src)) return alt;
      if (imageOnly) return image;
      return `[${alt || src}](${src})`;
    }
  );
}

/** Wraps `content` in a Markdown delimiter, keeping its edge spaces outside. */
function delimit(delimiter: string, content: string): string {
  const match = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const [, leading = '', inner = '', trailing = ''] = match ?? [];
  if (!inner) return content;
  return `${leading}${delimiter}${inner}${delimiter}${trailing}`;
}

function pairedTag(
  text: string,
  tags: string,
  render: (content: string, attributes: string) => string
): string {
  // Innermost first, so nested tags of the same kind each convert.
  const pattern = new RegExp(
    `<(${tags})(\\s[^>]*)?>((?:(?!<(?:${tags})[\\s>])[\\s\\S])*?)</\\1\\s*>`,
    'gi'
  );
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replace(
      pattern,
      (_tag, _name: string, attributes: string | undefined, content: string) =>
        render(content, attributes ?? '')
    );
  } while (current !== previous);
  return current;
}

function convertHtml(prose: string, saved: string[]): string {
  let text = prose
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<img(\s[^>]*)?\/?>/gi, (_tag, attributes: string | undefined) =>
      imageTag(attributes ?? '')
    )
    // Before the formats, so a bold label keeps no stray wrapper at its edge.
    .replace(
      new RegExp(`</?(?:${INLINE_WRAPPER_TAGS})(?:\\s[^>]*)?/?>`, 'gi'),
      ''
    );

  // A dropped icon takes its trailing space along, so `**<icon> Low**`
  // still reads as bold.
  text = text.replace(new RegExp(`${DROPPED}[ \\t]*`, 'g'), '');

  text = pairedTag(text, 'a', (content, attributes) => {
    const href = attribute(attributes, 'href');
    const label = content.trim();
    if (!label) return '';
    if (!href) return label;
    return `[${label}](${escapeUrl(href)})`;
  });
  text = pairedTag(text, 'strong|b', (content) => delimit('**', content));
  text = pairedTag(text, 'em|i', (content) => delimit('*', content));
  text = pairedTag(text, 'del|s|strike', (content) => delimit('~~', content));
  text = pairedTag(text, 'code|kbd|samp|tt', (content) => {
    // A code span shows entities literally, so decode them first; protect
    // it from the rewriting below, as a written code span is.
    const span = delimit('`', decodeAttribute(content).replace(/`/g, "'"));
    saved.push(span);
    return PLACEHOLDER(saved.length - 1);
  });
  text = pairedTag(text, 'ins', (content) => `<u>${content}</u>`);

  return (
    text
      // Headings: GitHub writes `<h3>Title</h3>`; the level is in the tag.
      .replace(
        /<h([1-6])(?:\s[^>]*)?>([^<\n]*)<\/h\1\s*>/gi,
        (_tag, level: string, content: string) =>
          `\n\n${'#'.repeat(Number(level))} ${content.trim()}\n\n`
      )
      // Attributes on formats our importer reads by their bare tag.
      .replace(/<(sup|sub|u)\s[^>]*>/gi, '<$1>')
      .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
      .replace(/<li(?:\s[^>]*)?>/gi, '\n- ')
      .replace(/<\/li\s*>/gi, '\n')
      .replace(
        new RegExp(`</?(?:${BLOCK_WRAPPER_TAGS})(?:\\s[^>]*)?/?>`, 'gi'),
        '\n\n'
      )
      // Collapsible sections: each tag on a line of its own, the summary
      // directly under its `<details>`, for the details transformer.
      .replace(/<details(\s[^>]*)?>/gi, '\n\n<details$1>\n')
      .replace(/<summary(?:\s[^>]*)?>/gi, '<summary>')
      .replace(/<\/summary\s*>/gi, '</summary>\n\n')
      .replace(/<\/details\s*>/gi, '\n\n</details>\n\n')
      // `[text](<url>)`: CommonMark's bracketed link destination.
      .replace(
        /\]\(\s*<([^>\n]+)>/g,
        (_match, url: string) => `](${escapeUrl(url.trim())}`
      )
      // `<https://…>`: an autolink, which our importer links bare.
      .replace(/<((?:https?|mailto):[^>\s]+)>/gi, '$1')
  );
}

function convertLines(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => {
        const alert = line.match(
          /^(\s*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i
        );
        if (alert) {
          return `${alert[1]}**${ALERT_LABELS[alert[2].toUpperCase()]}**`;
        }
        // A task item whose marker comment was removed: one space after it.
        const task = line.match(/^(\s*[-*+] \[[ xX]\]) {2,}(.*)$/);
        if (task) return `${task[1]} ${task[2]}`;
        // A lone `<br>` is spacing between blocks, not a line break.
        if (/^\s*(?:<br\s*\/?>\s*)+$/i.test(line)) return '';
        if (/^\s*$/.test(line)) return '';
        return inlineImages(line);
      })
      .join('\n')
      // Removals leave runs of blank lines; one separates blocks.
      .replace(/\n{3,}/g, '\n\n')
  );
}

/** Replaces code spans with placeholders, so HTML rewriting skips them. */
function protectCodeSpans(prose: string, saved: string[]): string {
  return prose.replace(
    /(?<!`)(`+)(?!`)(?:(?!\n\s*\n)[\s\S])+?(?<!`)\1(?!`)/g,
    (span) => {
      saved.push(span);
      return PLACEHOLDER(saved.length - 1);
    }
  );
}

function convertProse(prose: string, saved: string[]): string {
  return convertLines(convertHtml(protectCodeSpans(prose, saved), saved));
}

/**
 * Splits Markdown into prose and fenced code blocks, so only prose is
 * rewritten. An unclosed fence runs to the end, as in CommonMark.
 */
function splitFences(markdown: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  let prose: string[] = [];
  let fence: string[] | null = null;
  let closing: RegExp | null = null;

  for (const line of markdown.split('\n')) {
    if (fence && closing) {
      fence.push(line);
      if (closing.test(line)) {
        parts.push({ code: true, text: fence.join('\n') });
        fence = null;
        closing = null;
      }
      continue;
    }
    const open = line.match(FENCE_OPEN);
    if (open) {
      parts.push({ code: false, text: prose.join('\n') });
      prose = [];
      fence = [line];
      const marker = open[1];
      closing = new RegExp(
        `^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`
      );
      continue;
    }
    prose.push(line);
  }
  if (fence) parts.push({ code: true, text: fence.join('\n') });
  parts.push({ code: false, text: prose.join('\n') });
  return parts;
}

export function normalizeGithubMarkdown(markdown: string): string {
  const saved: string[] = [];
  const normalized = splitFences(markdown.replace(/\r\n?/g, '\n'))
    .map((part) =>
      part.code ? `\n${part.text}\n` : convertProse(part.text, saved)
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized.replace(
    PLACEHOLDER_PATTERN,
    (_placeholder, index: string) => saved[Number(index)] ?? ''
  );
}
