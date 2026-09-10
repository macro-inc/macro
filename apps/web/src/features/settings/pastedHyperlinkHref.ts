export function pastedHyperlinkHref(args: {
  clipboardPlainText: string;
  selectionCollapsed: boolean;
  selectionOps: ReadonlyArray<{ insert?: unknown }>;
}): string | null {
  if (args.selectionCollapsed) return null;
  if (
    args.selectionOps.length === 0 ||
    args.selectionOps.some((op) => typeof op.insert !== 'string')
  ) {
    return null;
  }
  const href = args.clipboardPlainText.trim();
  if (/\s/.test(href)) return null;
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }
  return href;
}
