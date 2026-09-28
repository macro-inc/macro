/** First-party Claude identity, matching the backend bot_id registry. */
export const CLAUDE_BOT_ID = '00000000-0000-0000-0000-00000000c1a0';
export const CLAUDE_BOT_PRINCIPAL_ID = `bot|${CLAUDE_BOT_ID}`;
export const CLAUDE_BOT_NAME = 'Claude';
export const CLAUDE_BOT_HANDLE = 'claude';
export function isClaudeBotId(id: string): boolean {
  return id === CLAUDE_BOT_ID || id === CLAUDE_BOT_PRINCIPAL_ID;
}
