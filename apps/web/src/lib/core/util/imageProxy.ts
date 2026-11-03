import { SERVER_HOSTS } from '../constant/servers';

/**
 * GitHub blob and `/raw/` links are HTML redirect pages, not image bytes.
 * Markdown `![alt](https://github.com/…/blob/…png?raw=true)` is the usual
 * form in PR descriptions; the browser's COEP + `crossorigin` check fails on
 * the github.com 302 (no CORS), so the image never loads. Point at the raw
 * file host instead.
 */
export function githubRawImageUrl(src: string): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return src;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 4) return src;
  const [owner, repo, kind, ...rest] = parts;
  if (kind !== 'blob' && kind !== 'raw') return src;
  if (rest.length === 0) return src;

  if (rest[0] === 'refs' && (rest[1] === 'heads' || rest[1] === 'tags')) {
    rest.splice(0, 2);
    if (rest.length === 0) return src;
  }

  return `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join('/')}`;
}

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

/** URL to put on an `<img>` for a remote markdown image. */
export function displayImageUrl(src: string): string {
  // Markdown import turns a pasted image into a plain URL. Static files are
  // public and send their own CORS headers, while the proxy needs a session
  // cookie that a `crossorigin="anonymous"` image never sends.
  if (src.startsWith(`${SERVER_HOSTS['static-file']}/`)) return src;
  return proxyImageUrl(githubRawImageUrl(src));
}
