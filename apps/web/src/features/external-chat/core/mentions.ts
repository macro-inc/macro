const USER_MENTION = /<m-user-mention>(.*?)<\/m-user-mention>/g;

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
