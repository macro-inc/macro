import { SERVER_HOSTS } from '../constant/servers';

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
    if (!src.startsWith('http://') && !src.startsWith('https://')) continue;

    const proxiedUrl = `${SERVER_HOSTS['image-proxy-service']}/proxy?url=${encodeURIComponent(src)}`;
    img.setAttribute('src', proxiedUrl);
  }

  return container.innerHTML;
}
