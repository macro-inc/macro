/**
 * Media markdown cannot safely carry. Embedded `data:` images are shown as
 * short stable placeholders and restored byte for byte on commit; uploaded
 * (DSS) images and videos keep a source identity markdown has no room for.
 */
import type { SerializedNode } from './document';
import { walk } from './document';

/**
 * A whole data: URI, up to the whitespace or `)` that ends a markdown image
 * source: RFC 2397 parameters may be percent-encoded (`;name=a%20b`) and the
 * data may hold `:` (an SVG's `http://` namespace).
 */
const DATA_URI_RE = /data:[a-z]+\/[a-z0-9.+-]+(?:;[^,\s)]*)*,[^\s)"]+/gi;
const PLACEHOLDER_RE = /data:redacted,[0-9a-zA-Z]*/g;

export class FrozenMediaError extends Error {}

/** FNV-1a over the URI, hex: stable, short, and synchronous. */
function placeholderFor(uri: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < uri.length; i++) {
    hash ^= BigInt(uri.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `data:redacted,${hash.toString(16).padStart(16, '0')}`;
}

/** Placeholder → original data: URI, for every data URI in `markdown`. */
export function mediaMap(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [uri] of markdown.matchAll(DATA_URI_RE))
    map.set(placeholderFor(uri), uri);
  return map;
}

/** What an agent sees: every data: URI replaced by its placeholder. */
export function redactMedia(markdown: string): string {
  return markdown.replace(DATA_URI_RE, (uri) => placeholderFor(uri));
}

/**
 * Put the original URIs back. A placeholder not in `map`, or a raw data: URI
 * that is not byte-identical to one already in the document, is a typed,
 * truncated or invented embedded image.
 */
export function restoreMedia(
  markdown: string,
  map: Map<string, string>
): string {
  const originals = new Set(map.values());
  for (const [uri] of markdown.matchAll(DATA_URI_RE))
    if (!originals.has(uri))
      throw new FrozenMediaError(
        'an embedded (data:) image was changed or invented; keep its data:redacted,… link exactly as given'
      );
  return markdown.replace(
    PLACEHOLDER_RE,
    (placeholder: string, at: number, text: string) => {
      const original = map.get(placeholder);
      if (original) return original;
      // Prose that merely reads like a placeholder is left alone; only a
      // media source naming an unknown one is refused.
      if (!/(\]\(|"url":")$/.test(text.slice(Math.max(0, at - 7), at)))
        return placeholder;
      throw new FrozenMediaError(
        `unknown embedded image ${placeholder}; keep data:redacted,… links exactly as given`
      );
    }
  );
}

/** Uploaded image/video sources: `srcType|id|url`. */
export function uploadedSources(node: SerializedNode): string[] {
  const sources: string[] = [];
  walk(node, (n) => {
    if (n.type !== 'image' && n.type !== 'video') return;
    if (n.srcType === 'dss')
      sources.push(`${n.srcType}|${String(n.id ?? '')}|${String(n.url)}`);
  });
  return sources;
}
