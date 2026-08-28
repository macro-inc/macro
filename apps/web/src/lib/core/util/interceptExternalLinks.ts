import { openExternalUrl } from '@core/util/url';

const INTERCEPTED_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'sms:',
]);

function isInterceptedHref(raw: string): boolean {
  const href = raw.trim();
  if (!href || href.startsWith('#')) return false;
  if (href.startsWith('//')) return true;
  try {
    return INTERCEPTED_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
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
    if (!isInterceptedHref(a.getAttribute('href') ?? '')) continue;
    a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      e.preventDefault();
      openExternalUrl(a.href);
    });
  }
}
