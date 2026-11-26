/**
 * The schemes a link in content may open: the ones Lexical's `LinkNode` lets
 * an editor link open, so a link works the same in an editor and when rendered.
 */
export const LINK_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
  'sms:',
  'tel:',
]);

// A relative link resolves against the page it is on, so it keeps the page's
// own scheme; this base stands in for that page.
const RELATIVE_LINK_BASE = 'https://relative-link.invalid/';

/**
 * Whether `url` opens one of `protocols` (by default the link schemes), or is
 * relative. It is parsed the way a browser resolves an `href`, which drops
 * control characters, whitespace and letter case, so none of them can disguise
 * a `javascript:` or `data:` URL. Content stores links as any string: check a
 * saved URL before it becomes a link or is opened.
 */
export function isAllowedLinkUrl(
  url: string,
  protocols: ReadonlySet<string> = LINK_PROTOCOLS
): boolean {
  try {
    return protocols.has(new URL(url, RELATIVE_LINK_BASE).protocol);
  } catch {
    return false;
  }
}
