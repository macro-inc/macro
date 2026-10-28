/**
 * How the Comments pane and the slide's comment markers present threads:
 * relative times, initials, and marker positions that do not overlap.
 */

import type { Point } from './geometry';

/**
 * When a comment was written, as PowerPoint's Comments pane says it ("A few
 * seconds ago", "5 minutes ago", "Yesterday", "March 3", "March 3, 2024").
 */
export function relativeTime(created: string | undefined, now: Date): string {
  if (!created) return '';
  const date = new Date(created);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return '';
  const seconds = Math.max(0, (now.getTime() - ms) / 1000);
  if (seconds < 60) return 'A few seconds ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay || hours < 6)
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  return date.getFullYear() === now.getFullYear()
    ? `${month} ${date.getDate()}`
    : `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

/** The initials shown in an author's circle: stored ones, else from the name. */
export function initialsOf(name: string, initials?: string): string {
  const given = initials?.trim();
  if (given) return given.slice(0, 3);
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => [...w][0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/** A stable hue (0-359) for an author, so their circles keep one color. */
export function authorHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + (c.codePointAt(0) ?? 0)) % 360;
  return h;
}

/**
 * Marker positions in CSS pixels for anchors in slide points: markers that
 * would sit on top of each other step right, as PowerPoint fans them out.
 */
export function stackMarkers(
  anchors: Point[],
  scale: number,
  size: number
): Point[] {
  const placed: Point[] = [];
  for (const a of anchors) {
    const p = { x: a.x * scale, y: a.y * scale };
    while (
      placed.some(
        (q) =>
          Math.abs(q.x - p.x) < size * 0.75 && Math.abs(q.y - p.y) < size * 0.75
      )
    )
      p.x += size * 0.8;
    placed.push(p);
  }
  return placed;
}
