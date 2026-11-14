/**
 * Slack formats with mrkdwn (`*bold*`, `_italic_`, `~strike~`, `` `code` ``,
 * ```` ```preformatted``` ````, `>` quotes) and wraps references in angle
 * brackets (`<@U…>`, `<#C…|name>`, `<!here>`, `<url|text>`), escaping `&`,
 * `<` and `>` as entities. The composer and the message renderer speak
 * Markdown. These convert at the send and display edges.
 */

import type { Mention } from '../../core/rich';
import {
  inlineCode,
  literal,
  mentionMarkdown,
  urlLink,
} from '../markdown-text';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
};

/** Slack's three entities back to their characters. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt);/g,
    (entity) => ENTITIES[entity] ?? entity
  );
}

/** Received plain text as literal Markdown. */
function plain(text: string): string {
  return literal(decodeEntities(text));
}

/** `<!here>`, `<!subteam^S1|@design>`, `<!date^…|Nov 3>`: their label. */
function specialMention(body: string, label: string | undefined): string {
  const [command = ''] = body.split('^');
  if (['here', 'channel', 'everyone'].includes(command))
    return `**@${command}**`;
  return label ? `**${plain(label)}**` : '';
}

/** A Slack link to a web or mail address; anything else stays its text. */
function slackLink(target: string, label: string | undefined): string {
  const url = decodeEntities(target);
  if (!/^(?:https?:\/\/|mailto:)/i.test(url)) return plain(label ?? target);
  if (!label) return urlLink(url);
  const href = url
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/ /g, '%20');
  return `[${plain(label)}](${href})`;
}

/** One `<…>` reference as Markdown. */
function reference(body: string, mentions: Mention[]): string {
  const bar = body.indexOf('|');
  const target = bar === -1 ? body : body.slice(0, bar);
  const label = bar === -1 ? undefined : body.slice(bar + 1);
  if (target.startsWith('@')) {
    const id = target.slice(1);
    const mention = mentions.find((each) => each.token === id);
    if (mention) return mentionMarkdown(mention);
    return `**@${plain(label ?? 'someone')}**`;
  }
  if (target.startsWith('#')) return `**#${plain(label ?? 'channel')}**`;
  if (target.startsWith('!')) return specialMention(target.slice(1), label);
  return slackLink(target, label);
}

/** mrkdwn's inline syntax, one alternative per group. */
const SLACK_INLINE =
  /(`[^`\n]+`)|<([^<>\n]+)>|(^|[^\p{L}\p{N}*_~])([*_~])(?!\s)([^\n]*?[^\s*_~]|[^\s*_~])\4(?![\p{L}\p{N}*_~])/gu;

const MARKDOWN_FOR: Record<string, string> = { '*': '**', _: '*', '~': '~~' };

function slackInline(text: string, mentions: Mention[]): string {
  let out = '';
  let last = 0;
  for (const found of text.matchAll(SLACK_INLINE)) {
    const [whole, code, angle, before = '', marker = '', inner = ''] = found;
    out += plain(text.slice(last, found.index));
    last = found.index + whole.length;
    if (code !== undefined)
      out += inlineCode(decodeEntities(code), out, text[last]);
    else if (angle !== undefined) out += reference(angle, mentions);
    else {
      const markdown = MARKDOWN_FOR[marker] ?? '';
      out += `${plain(before)}${markdown}${slackInline(inner, mentions)}${markdown}`;
    }
  }
  return out + plain(text.slice(last));
}

/** `&gt; ` quotes and `•`/`-` bullets, as Slack's clients write them. */
const SLACK_LINE = /^(?:(?:&gt;|>) ?|([•◦▪-]) |(\d{1,9})\. )/;

function slackLine(line: string, mentions: Mention[]): string {
  const block = SLACK_LINE.exec(line);
  if (!block) return slackInline(line, mentions);
  const rest = slackInline(line.slice(block[0].length), mentions);
  if (block[1]) return `- ${rest}`;
  if (block[2]) return `${block[2]}. ${rest}`;
  return `> ${rest}`;
}

/**
 * A received Slack body (mrkdwn, as DSS stores it) as Markdown for the shared
 * message renderer. Only what this function writes is Markdown: Slack's own
 * formatting, links to web and mail addresses, `@here`-style and channel
 * references in bold, and for each `<@U…>` DSS listed in `mentions` Chat's
 * user-mention chip (verified Macro users) or the Slack name in bold.
 * Everything else is literal text.
 */
export function slackToMarkdown(
  text: string,
  mentions: Mention[] = []
): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part) =>
      part.startsWith('```') && part.endsWith('```') && part.length >= 6
        ? `\n\`\`\`\n${decodeEntities(part.slice(3, -3))
            .replace(/^\n|\n$/g, '')
            .replace(/```/g, '`​``')}\n\`\`\`\n`
        : part
            .split('\n')
            .map((line) => slackLine(line, mentions))
            .join('\n')
    )
    .join('')
    .trim();
}

const FENCE = /^```/;

/** Slack's entities for text it would otherwise read as syntax. */
function encodeEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Markdown inline syntax the composer writes, one alternative per group. */
const MARKDOWN_INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1|\\([\\`*_{}[\]()#+\-.!~>|<])|\*\*((?:[^*]|\*[^*\s](?:[^*]*?[^*\s])?\*)+?)\*\*|__([\s\S]+?)__|\*([^*\s](?:[\s\S]*?[^*\s])?)\*|_([^_\s](?:[\s\S]*?[^_\s])?)_|~~([\s\S]+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>/g;

function markdownInline(text: string): string {
  let out = '';
  let last = 0;
  for (const found of text.matchAll(MARKDOWN_INLINE)) {
    const [
      whole,
      _ticks,
      code,
      escaped,
      starBold,
      underscoreBold,
      starItalic,
      underscoreItalic,
      strike,
      linkText,
      linkUrl,
      autolink,
    ] = found;
    out += encodeEntities(text.slice(last, found.index));
    last = found.index + whole.length;
    const bold = starBold ?? underscoreBold;
    const italic = starItalic ?? underscoreItalic;
    if (code !== undefined) out += `\`${encodeEntities(code)}\``;
    else if (escaped !== undefined) out += encodeEntities(escaped);
    else if (bold !== undefined) out += `*${markdownInline(bold)}*`;
    else if (italic !== undefined) out += `_${markdownInline(italic)}_`;
    else if (strike !== undefined) out += `~${markdownInline(strike)}~`;
    else if (linkText !== undefined && linkUrl !== undefined)
      out +=
        linkText === linkUrl
          ? `<${linkUrl}>`
          : `<${linkUrl}|${encodeEntities(linkText).replace(/\|/g, '¦')}>`;
    else if (autolink !== undefined) out += `<${autolink}>`;
  }
  return out + encodeEntities(text.slice(last));
}

function markdownLine(line: string): string {
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return `*${markdownInline(heading[1] ?? '')}*`;
  const quote = /^>\s?(.*)$/.exec(line);
  if (quote) return `&gt; ${markdownInline(quote[1] ?? '')}`;
  return markdownInline(line.replace(/^(\s*)[*+-]\s+/, '$1• '));
}

/** Composer Markdown to the mrkdwn Slack sends and formats. */
export function markdownToSlack(markdown: string): string {
  const out: string[] = [];
  let code: string[] | undefined;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      if (code) {
        out.push(`\`\`\`${encodeEntities(code.join('\n'))}\`\`\``);
        code = undefined;
      } else code = [];
      continue;
    }
    if (code) code.push(line);
    else out.push(markdownLine(line));
  }
  // An unterminated fence still sends its lines as preformatted.
  if (code) out.push(`\`\`\`${encodeEntities(code.join('\n'))}\`\`\``);
  return out.join('\n').trim();
}
