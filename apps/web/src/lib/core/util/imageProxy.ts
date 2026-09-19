import { SERVER_HOSTS } from '../constant/servers';

/**
 * Rewrite an external image URL to load through the image proxy service.
 *
 * The app is served with `Cross-Origin-Embedder-Policy: require-corp`, so
 * cross-origin images are blocked unless the host opts in via CORP/CORS
 * headers. The proxy fetches the upstream image server-side and responds
 * with `Cross-Origin-Resource-Policy: cross-origin`, so proxied images
 * always render. Non-HTTP(S) URLs (e.g. `data:`) are returned unchanged.
 */
export function proxyImageUrl(src: string): string {
  if (!src.startsWith('http://') && !src.startsWith('https://')) return src;
  return `${SERVER_HOSTS['image-proxy-service']}/proxy?url=${encodeURIComponent(src)}`;
}
