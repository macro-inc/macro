/**
 * Received provider text as safe Markdown pieces, shared by the providers'
 * `toMarkdown` converters. Only what these write is Markdown.
 */

import type { Mention } from '../core/rich';

/** ASCII punctuation, minus the `@` that mentions are found by. */
const PUNCTUATION = /[!-/:-?[-`{-~]/g;

/**
 * Received text as literal Markdown text: every punctuation mark becomes a
 * numeric character reference, which the Markdown importer decodes back to
 * the character after it has looked for syntax. No sender-written Markdown,
 * HTML or Macro tag (`<m-user-mention>`, `[[…]]`, `$$…$$`) can take effect.
 */
export function literal(text: string): string {
  return text.replace(
    PUNCTUATION,
    (character) => `&#${character.charCodeAt(0)};`
  );
}

/** A bare URL as a Markdown link, so it renders like Chat's links (with their preview). */
export function urlLink(url: string): string {
  const href = (url.startsWith('www.') ? `https://${url}` : url)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
  return `[${literal(url)}](${href})`;
}

/** `macro|ana@example.com` → its email; the mention chip resolves the name. */
function macroEmail(userId: string): string | undefined {
  return userId.startsWith('macro|')
    ? userId.slice('macro|'.length)
    : undefined;
}

/**
 * A mentioned person: a verified Macro user becomes Chat's mention chip,
 * anyone else their name in the provider (or WhatsApp number) in bold, as the provider shows
 * it. The chip's JSON escapes `<` and `>`, so a name can't close the tag.
 */
export function mentionMarkdown(mention: Mention): string {
  const email = mention.userId ? macroEmail(mention.userId) : undefined;
  if (!mention.userId || !email) return `**@${literal(mention.name)}**`;
  const json = JSON.stringify({
    userId: mention.userId,
    email,
    displayName: mention.name,
  })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  return `<m-user-mention>${json}</m-user-mention>`;
}

/**
 * Characters a code span may hold. The importer neither decodes nor
 * transforms inside a code span, so it must hold nothing a Macro tag, link,
 * citation or equation could start with.
 */
const SAFE_CODE = /^[\p{L}\p{N}\s.,;?'"()+\-=/#%@^{}|]+$/u;

/**
 * `` `code` `` as a code span when that is safe and will form (not beside
 * another span's backtick); otherwise as literal text.
 */
export function inlineCode(
  code: string,
  before: string,
  after: string | undefined
) {
  const content = code.slice(1, -1);
  if (SAFE_CODE.test(content) && !before.endsWith('`') && after !== '`')
    return code;
  return literal(code);
}
