/** Prefer the first match, leaving full search selected when only fallbacks exist. */
export function defaultCommandResultIndex(items: readonly { kind: string }[]) {
  return items[0]?.kind === 'search' && items[1] && items[1].kind !== 'ask-ai'
    ? 1
    : 0;
}
