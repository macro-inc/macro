import { proxyImageUrl } from '../util/imageProxy';

/**
 * Serves images through image proxy service to avoid storing data.
 * Rewrites external `<img>` src attributes in HTML to route through the image proxy service.
 * Skips non-HTTP(S) schemes (e.g. `data:`).
 */
export function proxyEmailImages(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  const images = container.querySelectorAll('img[src]');
  for (const img of images) {
    const src = img.getAttribute('src')?.replace(/\s/g, '');
    if (!src) continue;
    const proxied = proxyImageUrl(src);
    if (proxied === src) continue;

    img.setAttribute('src', proxied);
  }

  return container.innerHTML;
}
