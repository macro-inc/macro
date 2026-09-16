/** First-party Codex identity, matching the backend bot_id registry. */
export const CODEX_BOT_ID = '00000000-0000-0000-0000-00000000c0de';
export const CODEX_BOT_PRINCIPAL_ID = `bot|${CODEX_BOT_ID}`;
export const CODEX_BOT_NAME = 'Codex';
export const CODEX_BOT_HANDLE = 'codex';
export function isCodexBotId(id: string): boolean {
  return id === CODEX_BOT_ID || id === CODEX_BOT_PRINCIPAL_ID;
}
