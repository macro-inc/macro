import { openExternalUrl } from '@core/util/url';

/**
 * Routes clicks on raw `mailto:` anchors inside a rendered-HTML root through
 * `openExternalUrl` (which opens the in-app email composer). Scoped per render
 * root — replaces the former app-global mailto click interceptor.
 *
 * Modifier / non-primary-button clicks are left alone so the browser's default
 * behavior (open in new tab, etc.) still applies.
 */
export function interceptMailtoLinks(root: ParentNode) {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!a.href.startsWith('mailto:')) continue;
    a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      e.preventDefault();
      openExternalUrl(a.href);
    });
  }
}
