import { proxyResource } from '@service-unfurl/client';

/**
 * A web resource - a page's favicon, a preview image - loaded through
 * Macro's unfurl proxy rather than from the page's own host.
 */
export function proxiedResourceUrl(url: string): string {
  return proxyResource(url);
}
