import { openExternalUrl } from '@core/util/url';

const INTERCEPTED_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'sms:',
]);

/**
 * Absolute URL to open for a raw `href` attribute, or `undefined` to leave
 * the click to the browser.
 *
 * Reads the attribute, not `HTMLAnchorElement.href`. The resolved property
 * turns `#section` into `https://localhost/#section` and `//example.com` into
 * `tauri://example.com` inside the desktop shell. Protocol-relative hrefs
 * are forced to https so they stay on the public web.
 */
export function urlToOpenFromHref(raw: string): string | undefined {
  const href = raw.trim();
  if (!href || href.startsWith('#')) return undefined;
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  try {
    const url = new URL(absolute);
    if (!INTERCEPTED_PROTOCOLS.has(url.protocol)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * Routes primary clicks on http(s), mailto, tel, and sms anchors through
 * `openExternalUrl`. Native `target="_blank"` never reaches Tauri's
 * `on_navigation`, so those clicks otherwise do nothing. Modifier and
 * non-primary clicks stay native.
 */
export function interceptExternalLinks(root: ParentNode) {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = urlToOpenFromHref(a.getAttribute('href') ?? '');
    if (!url) continue;
    a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      e.preventDefault();
      openExternalUrl(url);
    });
  }
}

/** Stamp new-tab fallback attrs, then intercept primary clicks. */
export function stampHtmlEmailAnchors(root: ParentNode) {
  for (const a of root.querySelectorAll('a[href]')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  interceptExternalLinks(root);
}
