// Cursor now mints `grok_` keys; the `crsr_` keys minted before that still work.
const CURSOR_KEY_PREFIXES = ['grok_', 'crsr_'];

export const CURSOR_KEY_PLACEHOLDER = `${CURSOR_KEY_PREFIXES[0]}…`;

export const CURSOR_KEY_FORMAT_ERROR = `Cursor API keys start with ${CURSOR_KEY_PREFIXES.join(' or ')}`;

export function isCursorApiKey(key: string): boolean {
  return CURSOR_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}
