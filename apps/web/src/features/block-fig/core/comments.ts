/**
 * Comments on a design, as Figma pins them: a thread sits at a point on a
 * page, or on a layer (it moves with the layer), and holds replies,
 * mentions, and a resolved state. Pure helpers for anchoring, unread
 * state, filtering, and @mentions.
 */

import type { Rect } from '@core/fig-engine/types';
import type { Point } from './camera';

/**
 * Where a thread is pinned: a page, and a point relative to a layer's top
 * left (in page units), or to the page's origin when `nodeId` is null.
 */
export interface FigCommentAnchor {
  pageId: string;
  nodeId: string | null;
  x: number;
  y: number;
}

export interface FigPerson {
  id: string;
  name: string;
}

export interface FigComment {
  id: string;
  author: FigPerson;
  /** Plain text; mentions read `@Name`. */
  text: string;
  mentions: FigPerson[];
  /** Milliseconds since the epoch. */
  createdAt: number;
}

export interface FigCommentThread {
  /** The first comment's id. */
  id: string;
  /** `null` for a comment on the whole design. */
  anchor: FigCommentAnchor | null;
  resolved: boolean;
  /** The first comment, then replies, oldest first. */
  comments: FigComment[];
}

/** The anchor for a comment placed at page point `at` on `node` (or none). */
export function anchorAt(
  pageId: string,
  at: Point,
  node?: { id: string; bounds: Rect }
): FigCommentAnchor {
  const round = (v: number) => Math.round(v * 100) / 100;
  if (!node) return { pageId, nodeId: null, x: round(at.x), y: round(at.y) };
  return {
    pageId,
    nodeId: node.id,
    x: round(at.x - node.bounds.x),
    y: round(at.y - node.bounds.y),
  };
}

/**
 * The page point an anchor pins to, given the bounds of its layer as they
 * are now; `undefined` when the layer is gone.
 */
export function anchorPoint(
  anchor: FigCommentAnchor,
  nodeBounds: ReadonlyMap<string, Rect>
): Point | undefined {
  if (!anchor.nodeId) return { x: anchor.x, y: anchor.y };
  const b = nodeBounds.get(anchor.nodeId);
  if (!b) return undefined;
  return { x: b.x + anchor.x, y: b.y + anchor.y };
}

export type CommentFilter = 'open' | 'resolved' | 'all';

export function filterThreads(
  threads: readonly FigCommentThread[],
  filter: CommentFilter
): FigCommentThread[] {
  return threads.filter((t) =>
    filter === 'all' ? true : filter === 'resolved' ? t.resolved : !t.resolved
  );
}

/** Newest activity first. */
export function byActivity(
  threads: readonly FigCommentThread[]
): FigCommentThread[] {
  const last = (t: FigCommentThread) => t.comments.at(-1)?.createdAt ?? 0;
  return [...threads].sort((a, b) => last(b) - last(a));
}

/**
 * Whether a thread has comments by others newer than when this person
 * last read it (`seenAt`, ms; absent: never). A person's own comments are
 * never unread.
 */
export function isUnread(
  thread: FigCommentThread,
  me: string | undefined,
  seenAt: number | undefined
): boolean {
  return thread.comments.some(
    (c) => c.author.id !== me && c.createdAt > (seenAt ?? 0)
  );
}

/** The `@query` being typed before `caret`, if any. */
export function mentionQuery(
  text: string,
  caret: number
): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!m) return undefined;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

/** `text` with the `@query` at `start` replaced by `@Name `. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  person: FigPerson
): { text: string; caret: number } {
  const inserted = `@${person.name} `;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length,
  };
}

/** The people of `picked` whose `@Name` is still in `text`. */
export function mentionsIn(text: string, picked: readonly FigPerson[]) {
  const seen = new Set<string>();
  return picked.filter((p) => {
    if (seen.has(p.id) || !text.includes(`@${p.name}`)) return false;
    seen.add(p.id);
    return true;
  });
}

/** Splits text into plain runs and mentions of `people`, for display. */
export function mentionParts(
  text: string,
  people: readonly FigPerson[]
): { text: string; mention?: FigPerson }[] {
  const names = [...people].sort((a, b) => b.name.length - a.name.length);
  const parts: { text: string; mention?: FigPerson }[] = [];
  let plain = '';
  for (let i = 0; i < text.length; ) {
    const person =
      text[i] === '@'
        ? names.find((p) => text.startsWith(`@${p.name}`, i))
        : undefined;
    if (person) {
      if (plain) parts.push({ text: plain });
      plain = '';
      parts.push({ text: `@${person.name}`, mention: person });
      i += person.name.length + 1;
    } else {
      plain += text[i];
      i++;
    }
  }
  if (plain) parts.push({ text: plain });
  return parts;
}

/** "Just now", "5m", "3h", "2d", or a date. */
export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(at).toLocaleDateString();
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}
