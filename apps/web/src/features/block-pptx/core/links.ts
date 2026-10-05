/**
 * Hyperlinks as the engine spells them (`RunPatch.link`, `setShapeLink`):
 * an address (`https://…`, `mailto:…`), `#slide=<id>` for another slide, or
 * a slide show jump such as `#nextslide`. What the Insert Link dialog edits,
 * how links read in the UI, and where a click on one goes in a slide show.
 */

import type {
  DeckOutline,
  LinkRegion,
  ParagraphStyle,
  TextLayoutInfo,
  TextPos,
} from '@core/pptx-engine/types';

export const JUMPS = [
  { link: '#firstslide', label: 'First Slide' },
  { link: '#lastslide', label: 'Last Slide' },
  { link: '#nextslide', label: 'Next Slide' },
  { link: '#previousslide', label: 'Previous Slide' },
] as const;

const OTHER_JUMPS: Record<string, string> = {
  '#lastslideviewed': 'Last Slide Viewed',
  '#endshow': 'End Show',
};

export type LinkKind = 'web' | 'place' | 'email';

/** Which tab of the link dialog edits `link`. */
export function linkKind(link: string | undefined): LinkKind {
  if (!link) return 'web';
  if (link.startsWith('#')) return 'place';
  if (/^mailto:/i.test(link)) return 'email';
  return 'web';
}

/** The id of the slide a `#slide=<id>` link goes to. */
export function slideLinkId(link: string): number | undefined {
  const m = /^#slide=(\d+)$/.exec(link);
  return m ? Number(m[1]) : undefined;
}

/**
 * What a typed address means: `macro.com` → `https://macro.com`,
 * `you@macro.com` → `mailto:you@macro.com`, anything with a scheme as is.
 */
export function normalizeAddress(input: string): string {
  const text = input.trim();
  if (!text || text.startsWith('#')) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text)) return `mailto:${text}`;
  if (text.startsWith('//')) return `https:${text}`;
  return `https://${text}`;
}

/** A `mailto:` link with an optional subject. */
export function emailLink(address: string, subject: string): string {
  const to = address.trim().replace(/^mailto:/i, '');
  if (!to) return '';
  const s = subject.trim();
  return s ? `mailto:${to}?subject=${encodeURIComponent(s)}` : `mailto:${to}`;
}

/** The address and subject of a `mailto:` link. */
export function parseEmail(link: string): { address: string; subject: string } {
  const rest = link.replace(/^mailto:/i, '');
  const [address, query = ''] = rest.split('?', 2);
  const subject = new URLSearchParams(query).get('subject') ?? '';
  return { address: decodeURIComponent(address), subject };
}

/** A slide's title, or its first text, for slide lists. */
export function slideTitle(deck: DeckOutline, id: number): string {
  const slide = deck.slides.find((s) => s.id === id);
  if (!slide) return '';
  const titled =
    slide.shapes.find(
      (s) => s.placeholder === 'title' || s.placeholder === 'ctrTitle'
    ) ?? slide.shapes.find((s) => s.paragraphs?.some((p) => p.text.trim()));
  return (
    titled?.paragraphs
      ?.map((p) => p.text.trim())
      .filter(Boolean)
      .join(' ')
      .replaceAll('\u000b', ' ') ?? ''
  );
}

/** How a link reads in menus and tooltips. */
export function linkLabel(link: string, deck?: DeckOutline): string {
  const jump = JUMPS.find((j) => j.link === link);
  if (jump) return jump.label;
  if (OTHER_JUMPS[link]) return OTHER_JUMPS[link];
  const id = slideLinkId(link);
  if (id !== undefined) {
    const index = deck?.slides.findIndex((s) => s.id === id) ?? -1;
    if (index < 0 || !deck) return 'Another slide';
    const title = slideTitle(deck, id);
    return title ? `Slide ${index + 1}: ${title}` : `Slide ${index + 1}`;
  }
  if (/^mailto:/i.test(link)) return parseEmail(link).address;
  return link;
}

/** Where following a link in a slide show goes. */
export type LinkAction =
  | { kind: 'slide'; index: number }
  | { kind: 'end' }
  | { kind: 'open'; url: string }
  | { kind: 'none' };

/**
 * The action of `link` in a show at slide `current` (of `count`), with
 * `previous` the slide shown before it.
 */
export function linkAction(
  link: string,
  deck: DeckOutline,
  current: number,
  previous?: number
): LinkAction {
  const count = deck.slides.length;
  const slide = (index: number): LinkAction =>
    index >= 0 && index < count ? { kind: 'slide', index } : { kind: 'none' };
  switch (link) {
    case '#firstslide':
      return slide(0);
    case '#lastslide':
      return slide(count - 1);
    case '#nextslide':
      return current + 1 >= count ? { kind: 'end' } : slide(current + 1);
    case '#previousslide':
      return slide(current - 1);
    case '#lastslideviewed':
      return previous === undefined ? { kind: 'none' } : slide(previous);
    case '#endshow':
      return { kind: 'end' };
  }
  const id = slideLinkId(link);
  if (id !== undefined) return slide(deck.slides.findIndex((s) => s.id === id));
  if (link.startsWith('#')) return { kind: 'none' };
  return safeUrl(link) ? { kind: 'open', url: link } : { kind: 'none' };
}

/** Whether a link may be opened from the app (no `javascript:` and kin). */
export function safeUrl(url: string): boolean {
  return /^(https?:|mailto:|tel:|ftp:)/i.test(url.trim());
}

/** The link region (earlier wins) under slide point `(x, y)`. */
export function regionAt(
  regions: LinkRegion[],
  x: number,
  y: number
): LinkRegion | undefined {
  return regions.find((r) => inQuad(r.quad, x, y));
}

function inQuad(q: LinkRegion['quad'], x: number, y: number): boolean {
  // Convex quad: the point is on the same side of every edge.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = [q[2 * i], q[2 * i + 1]];
    const [bx, by] = [q[(2 * i + 2) % 8], q[(2 * i + 3) % 8]];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** The link of the run at `pos` (the character after it, else before). */
export function linkAt(
  layout: TextLayoutInfo | null,
  pos: TextPos
): string | undefined {
  return linkRunAt(layout?.styles[pos.paragraph], pos.offset)?.link;
}

function linkRunAt(style: ParagraphStyle | undefined, offset: number) {
  const runs = style?.runs ?? [];
  return (
    runs.find((r) => r.link && offset >= r.start && offset < r.end) ??
    runs.find((r) => r.link && offset > r.start && offset <= r.end)
  );
}

/**
 * The whole stretch of text carrying the link at `pos` (neighbouring runs
 * with the same link), with its link and ScreenTip.
 */
export function linkSpan(
  layout: TextLayoutInfo | null,
  pos: TextPos
): { start: TextPos; end: TextPos; link: string; tip?: string } | undefined {
  const style = layout?.styles[pos.paragraph];
  const run = linkRunAt(style, pos.offset);
  if (!style || !run?.link) return undefined;
  let start = run.start;
  let end = run.end;
  for (const r of [...style.runs].reverse())
    if (r.end === start && r.link === run.link) start = r.start;
  for (const r of style.runs)
    if (r.start === end && r.link === run.link) end = r.end;
  return {
    start: { paragraph: pos.paragraph, offset: start },
    end: { paragraph: pos.paragraph, offset: end },
    link: run.link,
    tip: run.linkTip,
  };
}
