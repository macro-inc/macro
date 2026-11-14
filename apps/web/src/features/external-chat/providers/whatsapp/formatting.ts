/**
 * WhatsApp formats with single markers (`*bold*`, `_italic_`, `~strike~`,
 * `` `code` ``, ```` ```monospace``` ````); the composer and the message
 * renderer speak Markdown. These convert at the send and display edges.
 */

import { mentionPattern } from '../../core/mentions';
import type { Mention } from '../../core/rich';
import {
  inlineCode,
  literal,
  mentionMarkdown,
  urlLink,
} from '../markdown-text';

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

const MARKDOWN_FOR: Record<string, string> = { '*': '**', _: '*', '~': '~~' };

function plainText(text: string, mentions: Mention[]): string {
  const pattern = mentionPattern(mentions);
  if (!pattern) return literal(text);
  let out = '';
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    const mention = mentions.find((each) => each.token === found[1]);
    if (!mention) continue;
    out += literal(text.slice(last, found.index)) + mentionMarkdown(mention);
    last = found.index + found[0].length;
  }
  return out + literal(text.slice(last));
}

function whatsappInline(text: string, mentions: Mention[]): string {
  let out = '';
  let last = 0;
  for (const found of text.matchAll(WHATSAPP_INLINE)) {
    const [whole, code, url, before = '', marker = '', inner = ''] = found;
    out += plainText(text.slice(last, found.index), mentions);
    last = found.index + whole.length;
    if (code !== undefined) out += inlineCode(code, out, text[last]);
    else if (url !== undefined) out += urlLink(url);
    else {
      const markdown = MARKDOWN_FOR[marker] ?? '';
      out += `${plainText(before, mentions)}${markdown}${whatsappInline(inner, mentions)}${markdown}`;
    }
  }
  return out + plainText(text.slice(last), mentions);
}

/** WhatsApp's line formats: `- ` / `* ` bullets, `1. ` numbers and `> ` quotes. */
const WHATSAPP_LINE = /^(?:([-*]) |(\d{1,9})\. |> ?)/;

function whatsappLine(line: string, mentions: Mention[]): string {
  const block = WHATSAPP_LINE.exec(line);
  if (!block) return whatsappInline(line, mentions);
  const rest = whatsappInline(line.slice(block[0].length), mentions);
  if (block[1]) return `- ${rest}`;
  if (block[2]) return `${block[2]}. ${rest}`;
  return `> ${rest}`;
}

/**
 * A received WhatsApp body as Markdown for the shared message renderer.
 * Only what this function writes is Markdown: WhatsApp's own formatting,
 * links for bare http(s) URLs, and a mention chip for each `@<token>` that
 * DSS matched to a verified Macro user. Everything else is literal text.
 */
export function whatsappToMarkdown(
  text: string,
  mentions: Mention[] = []
): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part) =>
      part.startsWith('```') && part.endsWith('```') && part.length >= 6
        ? `\n\`\`\`\n${part.slice(3, -3).replace(/^\n|\n$/g, '')}\n\`\`\`\n`
        : part
            .split('\n')
            .map((line) => whatsappLine(line, mentions))
            .join('\n')
    )
    .join('')
    .trim();
}
