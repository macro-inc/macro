import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';
import type { PreviewTab } from './primitives/create-preview';

/**
 * A browser tab opened during the click, while the browser still allows
 * it, and pointed at the preview once the form is ready. Native shells
 * open the system browser then instead.
 */
export function reservePreviewTab(): PreviewTab | undefined {
  if (isTauri()) return { show: openExternalUrl, close: () => {} };
  const tab = window.open('about:blank', '_blank');
  if (!tab) return undefined;
  tab.opener = null;
  tab.document.title = 'Opening preview…';
  tab.document.body.textContent = 'Saving your changes for the preview…';
  return {
    show: (url) => {
      if (!tab.closed) tab.location.replace(url);
    },
    close: () => tab.close(),
  };
}
