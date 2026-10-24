import type { Mention } from './rich';

const USER_MENTION = /<m-user-mention>(.*?)<\/m-user-mention>/g;
const MARKDOWN_SPECIAL = /[\\`*_{}[\]()#+\-.!~>|<]/g;

function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIAL, (character) => `\\${character}`);
}

/** `macro|ana@example.com` → its email; the mention chip resolves the name. */
function macroEmail(userId: string): string | undefined {
  return userId.startsWith('macro|')
    ? userId.slice('macro|'.length)
    : undefined;
}

/**
 * A received body (already Markdown) with each `@<token>` replaced by the
 * person: Macro users become Chat's mention chip, anyone else their
 * WhatsApp name or number, set off in bold the way WhatsApp shows it.
 */
export function withMentions(markdown: string, mentions: Mention[]): string {
  if (mentions.length === 0) return markdown;
  const byToken = new Map(mentions.map((mention) => [mention.token, mention]));
  const tokens = [...byToken.keys()]
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(${tokens.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  return markdown.replace(pattern, (whole, token: string) => {
    const mention = byToken.get(token);
    if (!mention) return whole;
    const email = mention.userId ? macroEmail(mention.userId) : undefined;
    if (mention.userId && email)
      return `<m-user-mention>${JSON.stringify({
        userId: mention.userId,
        email,
        displayName: mention.name,
      })}</m-user-mention>`;
    return `**@${escapeMarkdown(mention.name)}**`;
  });
}

/** The digits WhatsApp shows after `@` for a participant id. */
export function mentionToken(jid: string): string {
  return jid.split('@')[0]?.split(':')[0] ?? jid;
}

/**
 * The composer's mention chips for group participants, turned into the
 * `@<digits>` text WhatsApp shows and the participant ids it notifies.
 * Chips for anyone outside `participants` stay as their name.
 */
export function composerMentions(
  markdown: string,
  participants: string[]
): { markdown: string; mentions: string[] } {
  const known = new Set(participants);
  const mentions: string[] = [];
  const text = markdown.replace(USER_MENTION, (_whole, json: string) => {
    let data: { userId?: unknown; displayName?: unknown };
    try {
      data = JSON.parse(json);
    } catch {
      return '';
    }
    const jid = typeof data.userId === 'string' ? data.userId : '';
    if (!known.has(jid))
      return typeof data.displayName === 'string' ? `@${data.displayName}` : '';
    if (!mentions.includes(jid)) mentions.push(jid);
    return `@${mentionToken(jid)}`;
  });
  return { markdown: text, mentions };
}
