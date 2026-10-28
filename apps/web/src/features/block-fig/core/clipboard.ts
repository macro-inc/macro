/**
 * Layers on the system clipboard, the way Figma puts them there: an HTML
 * fragment whose comments carry the metadata (`(figmeta)`, base64 JSON)
 * and the copied layers as a `.fig` document (`(figma)`, base64), so they
 * paste into another file or tab. Macro adds the images the layers use
 * (`(macroimages)`, a base64 ZIP), which Figma fetches from its servers.
 */

import type { CopiedLayers, NodeType } from '@core/fig-engine/types';

export interface ClipboardMeta {
  /** The file the layers came from (a Macro document id). */
  fileKey: string;
  /** Distinguishes one copy from the next. */
  pasteID: number;
  dataType: 'scene';
  /** The copied layers' ids in their file. */
  ids?: string[];
}

export interface ClipboardPayload {
  meta?: ClipboardMeta;
  copied: CopiedLayers;
}

/** Base64 of `bytes` (in chunks, so large documents do not overflow). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const marker = (name: string, body: string) =>
  `<!--(${name})${body}(/${name})-->`;

/** The clipboard's `text/html` for copied layers. */
export function encodeClipboard(payload: ClipboardPayload): string {
  const meta = payload.meta
    ? `<span data-metadata="${marker(
        'figmeta',
        toBase64(new TextEncoder().encode(JSON.stringify(payload.meta)))
      )}"></span>`
    : '';
  const images =
    payload.copied.images.length > 0
      ? `<span data-macro-images="${marker(
          'macroimages',
          toBase64(payload.copied.images)
        )}"></span>`
      : '';
  return `<meta charset="utf-8"><div>${meta}<span data-buffer="${marker(
    'figma',
    toBase64(payload.copied.document)
  )}"></span>${images}</div>`;
}

const between = (html: string, name: string) => {
  const match = new RegExp(
    `\\(${name}\\)([A-Za-z0-9+/=\\s]*)\\(/${name}\\)`
  ).exec(html);
  return match?.[1];
};

/** The copied layers in clipboard HTML (Macro's or Figma's), if any. */
export function decodeClipboard(html: string): ClipboardPayload | undefined {
  const buffer = between(html, 'figma');
  if (!buffer) return undefined;
  try {
    const document = fromBase64(buffer);
    const images = between(html, 'macroimages');
    const metaText = between(html, 'figmeta');
    let meta: ClipboardMeta | undefined;
    if (metaText) {
      try {
        meta = JSON.parse(new TextDecoder().decode(fromBase64(metaText)));
      } catch {
        meta = undefined;
      }
    }
    return {
      meta,
      copied: {
        document,
        images: images ? fromBase64(images) : new Uint8Array(),
      },
    };
  } catch {
    return undefined;
  }
}

/** Layers pasted layers can go into. */
const CONTAINERS: ReadonlySet<NodeType> = new Set<NodeType>([
  'FRAME',
  'SYMBOL',
  'SECTION',
]);

/**
 * Where a paste goes, by Figma's rules: into a selected frame (unless it is
 * one of the copied layers, pasted beside itself), next to a selected
 * layer, or onto the page.
 */
export function pasteParent(
  selection: { id: string; parent: string | null; type: NodeType }[],
  page: string,
  copiedHere: string[]
): string {
  const first = selection[0];
  if (!first || first.id.startsWith('I')) return page;
  if (
    selection.length === 1 &&
    CONTAINERS.has(first.type) &&
    !copiedHere.includes(first.id)
  )
    return first.id;
  return first.parent && !first.parent.startsWith('I') ? first.parent : page;
}
