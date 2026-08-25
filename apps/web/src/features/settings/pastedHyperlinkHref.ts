export function pastedHyperlinkHref(args: {
  clipboardPlainText: string;
  selectionCollapsed: boolean;
}): string | null {
  if (args.selectionCollapsed) return null;
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
