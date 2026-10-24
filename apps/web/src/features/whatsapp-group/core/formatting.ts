/**
 * WhatsApp formats with single markers (`*bold*`, `_italic_`, `~strike~`,
 * `` `code` ``, ```` ```monospace``` ````); the composer and the message
 * renderer speak Markdown. These convert at the send and display edges.
 */

const FENCE = /^```/;

/** Markdown inline syntax the composer writes, one alternative per group. */
const MARKDOWN_INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1|\\([\\`*_{}[\]()#+\-.!~>|<])|\*\*((?:[^*]|\*[^*\s](?:[^*]*?[^*\s])?\*)+?)\*\*|__([\s\S]+?)__|\*([^*\s](?:[\s\S]*?[^*\s])?)\*|_([^_\s](?:[\s\S]*?[^_\s])?)_|~~([\s\S]+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>/g;

function markdownInline(text: string): string {
  return text.replace(
    MARKDOWN_INLINE,
    (
      _match,
      _ticks: string | undefined,
      code: string | undefined,
      escaped: string | undefined,
      starBold: string | undefined,
      underscoreBold: string | undefined,
      starItalic: string | undefined,
      underscoreItalic: string | undefined,
      strike: string | undefined,
      linkText: string | undefined,
      linkUrl: string | undefined,
      autolink: string | undefined
    ) => {
      if (code !== undefined) return `\`${code}\``;
      if (escaped !== undefined) return escaped;
      const bold = starBold ?? underscoreBold;
      if (bold !== undefined) return `*${markdownInline(bold)}*`;
      const italic = starItalic ?? underscoreItalic;
      if (italic !== undefined) return `_${markdownInline(italic)}_`;
      if (strike !== undefined) return `~${markdownInline(strike)}~`;
      if (linkText !== undefined && linkUrl !== undefined)
        return linkText === linkUrl || `https://${linkText}` === linkUrl
          ? linkText
          : `${markdownInline(linkText)} (${linkUrl})`;
      return autolink ?? '';
    }
  );
}

function markdownLine(line: string): string {
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return `*${markdownInline(heading[1] ?? '')}*`;
  return markdownInline(line.replace(/^(\s*)[*+]\s+/, '$1- '));
}

/** Composer Markdown to the text WhatsApp sends and formats. */
export function markdownToWhatsApp(markdown: string): string {
  const out: string[] = [];
  let code: string[] | undefined;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      if (code) {
        out.push(`\`\`\`${code.join('\n')}\`\`\``);
        code = undefined;
      } else code = [];
      continue;
    }
    if (code) code.push(line);
    else out.push(markdownLine(line));
  }
  // An unterminated fence still sends its lines as monospace.
  if (code) out.push(`\`\`\`${code.join('\n')}\`\`\``);
  return out.join('\n').trim();
}

/** WhatsApp's markers, bounded by a non-word character or the line edge. */
const WHATSAPP_INLINE =
  /(`[^`\n]+`)|((?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?'")\]*_~])|(^|[^\p{L}\p{N}*_~])([*_~])(?!\s)([^\n]*?[^\s*_~]|[^\s*_~])\4(?![\p{L}\p{N}*_~])/gu;

/** A bare URL as a Markdown link, so it renders like Chat's links (with their preview). */
function urlLink(url: string): string {
  const href = (url.startsWith('www.') ? `https://${url}` : url)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
  return `[${url.replace(/[[\]\\]/g, '\\$&')}](${href})`;
}
const MARKDOWN_FOR: Record<string, string> = { '*': '**', _: '*', '~': '~~' };

function whatsappInline(text: string): string {
  return text.replace(
    WHATSAPP_INLINE,
    (
      match,
      code: string | undefined,
      url: string | undefined,
      before: string | undefined,
      marker: string,
      inner: string
    ) => {
      if (code !== undefined) return match;
      if (url !== undefined) return urlLink(url);
      const markdown = MARKDOWN_FOR[marker] ?? marker;
      return `${before ?? ''}${markdown}${whatsappInline(inner)}${markdown}`;
    }
  );
}

/** A received WhatsApp body as Markdown for the shared message renderer. */
export function whatsappToMarkdown(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part) =>
      part.startsWith('```') && part.endsWith('```') && part.length >= 6
        ? `\n\`\`\`\n${part.slice(3, -3).replace(/^\n|\n$/g, '')}\n\`\`\`\n`
        : whatsappInline(part)
    )
    .join('')
    .trim();
}
