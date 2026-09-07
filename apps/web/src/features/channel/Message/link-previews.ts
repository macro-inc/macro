import { getWebOrigin } from '@core/util/webOrigin';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';

/** Slack previews ~2 links per message, Discord up to 5; we split the middle. */
export const MAX_LINK_PREVIEWS = 3;

const CODE_FENCE_RE = /```[\s\S]*?(```|$)/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const M_LINK_RE = /<m-link>([\s\S]*?)<\/m-link>/g;
const MENTION_TAG_RE = /<(m-[a-z-]+)>[\s\S]*?<\/\1>/g;
// Target may contain balanced parens (wiki-style `..._(disambiguation)`).
const MD_LINK_RE =
  /\[[^\]]*\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)/g;
const BARE_URL_RE = /https?:\/\/[^\s<>]+/g;

const MACRO_HOSTS = new Set(['macro.com', 'www.macro.com', 'dev.macro.com']);

/** In-app entity links render as mentions/attachments already — no unfurl. */
function isInternalAppUrl(url: URL): boolean {
  const isMacroHost =
    MACRO_HOSTS.has(url.hostname) || url.origin === getWebOrigin();
  return (
    isMacroHost && (url.pathname === '/app' || url.pathname.startsWith('/app/'))
  );
}

/**
 * Bare URLs swallow adjacent prose: trailing sentence punctuation, and a
 * closing paren when the paren isn't part of the URL itself (wiki-style
 * `..._(disambiguation)` URLs keep theirs).
 */
function trimBareUrl(url: string): string {
  let trimmed = url;
  for (;;) {
    const next = trimmed.replace(/[.,;:!?'"”’]+$/, '');
    if (next.endsWith(')')) {
      const opens = next.split('(').length;
      const closes = next.split(')').length;
      if (closes > opens) {
        trimmed = next.slice(0, -1);
        continue;
      }
    }
    if (next === trimmed) return next;
    trimmed = next;
  }
}

/** The JSON payload inside an `<m-link>` tag (the editor's link node). */
type MLinkPayload = { url?: string; preview?: boolean };

/** Returns the payload's URL, or undefined for unparseable payloads and
 * links whose preview the sender removed (`preview: false`). */
function parseMLinkUrl(payload: string): string | undefined {
  try {
    const parsed = JSON.parse(payload) as MLinkPayload;
    return parsed.preview === false ? undefined : parsed.url;
  } catch {
    return undefined;
  }
}

type Candidate = { index: number; url: string };

/**
 * Replaces every match with same-length whitespace so later passes cannot
 * re-match inside it while all offsets stay in original-string coordinates.
 */
function blankOut(
  text: string,
  re: RegExp,
  onMatch?: (group: string, offset: number) => void
): string {
  return text.replace(re, (match, group: string, ...rest) => {
    // Offset precedes the full-string arg; group count varies per regex.
    const offset = rest.at(-2) as number;
    onMatch?.(group, typeof offset === 'number' ? offset : 0);
    return ' '.repeat(match.length);
  });
}

/**
 * Extracts the URLs in a message body eligible for a rich link preview, in
 * document order: the editor's `<m-link>` nodes, markdown-link targets, and
 * bare autolinked URLs, minus anything inside code, other mention tags, or
 * pointing back into the app. Deduped, capped at {@link MAX_LINK_PREVIEWS}.
 */
/**
 * Cheap gate so the regex pipeline does not run on ordinary messages.
 * `http` matches both `http://` and `https://`.
 */
export function contentMayHaveLinkPreviews(content: string): boolean {
  return content.includes('http');
}

export function extractUnfurlableUrls(content: string): string[] {
  if (!contentMayHaveLinkPreviews(content)) return [];

  const candidates: Candidate[] = [];

  let text = blankOut(content, CODE_FENCE_RE);
  text = blankOut(text, INLINE_CODE_RE);
  text = blankOut(text, M_LINK_RE, (payload, index) => {
    const url = parseMLinkUrl(payload);
    if (url) candidates.push({ index, url });
  });
  text = blankOut(text, MENTION_TAG_RE);
  text = blankOut(text, MD_LINK_RE, (url, index) => {
    candidates.push({ index, url });
  });
  for (const match of text.matchAll(BARE_URL_RE)) {
    candidates.push({ index: match.index, url: trimBareUrl(match[0]) });
  }
  candidates.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const { url } of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    if (isInternalAppUrl(parsed)) continue;
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    urls.push(url);
    if (urls.length >= MAX_LINK_PREVIEWS) break;
  }
  return urls;
}

/**
 * A card is only worth the space when the page gave us something beyond the
 * URL itself — the server falls back to echoing the URL as the title.
 */
export function shouldRenderUnfurl(unfurl: GetUnfurlResponse): boolean {
  if (unfurl.description || unfurl.image_url) return true;
  return Boolean(unfurl.title) && unfurl.title !== unfurl.url;
}

/** Tailwind `max-w-md` on the preview column / image frame. */
export const LINK_PREVIEW_IMAGE_WIDTH = 448;
/** Fixed landscape image frame (OG 1.91 at `max-w-md`). */
export const LINK_PREVIEW_IMAGE_HEIGHT = 235;
/** Domain + two-line title + two-line description. */
export const LINK_PREVIEW_CHROME_HEIGHT = 96;
/** Gap between chrome and the image frame (`gap-1`). */
export const LINK_PREVIEW_SLOT_GAP = 4;
/**
 * One preview slot: chrome + image. Loading, ready, and empty states all
 * use this height so virtua's first measure matches the settled row.
 */
export const LINK_PREVIEW_SLOT_HEIGHT =
  LINK_PREVIEW_CHROME_HEIGHT +
  LINK_PREVIEW_SLOT_GAP +
  LINK_PREVIEW_IMAGE_HEIGHT;

export type LinkPreviewSlotState = 'loading' | 'ready' | 'empty';

type UnfurlImageFields = Pick<GetUnfurlResponse, 'image_url'> & {
  image_width?: number | null;
  image_height?: number | null;
};

type UnfurlSlotInput = {
  type: 'loading' | 'error' | 'success';
  data?: GetUnfurlResponse;
};

/**
 * Slot state from the unfurl store. Missing and in-flight are both loading
 * so the first paint already owns the reserved height.
 */
export function linkPreviewSlotState(
  data: UnfurlSlotInput | undefined
): LinkPreviewSlotState {
  if (!data || data.type === 'loading') return 'loading';
  if (data.type === 'success' && data.data && shouldRenderUnfurl(data.data)) {
    return 'ready';
  }
  return 'empty';
}

/**
 * Pixel box for a preview image. Size is constant; `known` only picks
 * `object-contain` vs `object-cover` once bytes arrive.
 */
export function reservedPreviewImageSize(
  unfurl: UnfurlImageFields
): { width: number; height: number; known: boolean } | undefined {
  if (!unfurl.image_url) return undefined;
  return {
    width: LINK_PREVIEW_IMAGE_WIDTH,
    height: LINK_PREVIEW_IMAGE_HEIGHT,
    known: Boolean(unfurl.image_width && unfurl.image_height),
  };
}
