import type { Bounds, Point, Size } from './camera';

/** A placed rectangle; `x` and `y` are its top-left corner in world units. */
export type Placement = Bounds;

/**
 * Masonry: each rectangle goes into the currently shortest column, in order.
 * Returns placements relative to the origin and the total size.
 */
export function masonry(
  sizes: readonly Size[],
  options: { columns: number; columnWidth: number; gap: number }
): { placements: Placement[]; size: Size } {
  const columns = Math.max(1, options.columns);
  const heights = Array.from({ length: columns }, () => 0);
  const placements = sizes.map((size) => {
    let column = 0;
    for (let index = 1; index < columns; index++) {
      if (heights[index] < heights[column]) column = index;
    }
    const placement = {
      x: column * (options.columnWidth + options.gap),
      y: heights[column],
      width: options.columnWidth,
      height: size.height,
    };
    heights[column] += size.height + options.gap;
    return placement;
  });
  const usedColumns = Math.min(columns, sizes.length);
  return {
    placements,
    size: {
      width:
        usedColumns * options.columnWidth +
        Math.max(0, usedColumns - 1) * options.gap,
      height: Math.max(0, Math.max(...heights) - options.gap),
    },
  };
}

/**
 * Places blocks that each span `span` equal tracks onto a skyline: every
 * block takes the left-most position where its tracks are lowest. Keeps the
 * input order's priority while filling gaps under short neighbors.
 */
export function skyline(
  blocks: readonly { span: number; height: number }[],
  options: { tracks: number; trackWidth: number; gap: number }
): Point[] {
  const tracks = Math.max(
    1,
    options.tracks,
    ...blocks.map((block) => block.span)
  );
  const heights = Array.from({ length: tracks }, () => 0);
  return blocks.map((block) => {
    let bestTrack = 0;
    let bestTop = Infinity;
    for (let track = 0; track + block.span <= tracks; track++) {
      const top = Math.max(...heights.slice(track, track + block.span));
      if (top < bestTop) {
        bestTop = top;
        bestTrack = track;
      }
    }
    for (let track = bestTrack; track < bestTrack + block.span; track++) {
      heights[track] = bestTop + block.height + options.gap;
    }
    return {
      x: bestTrack * (options.trackWidth + options.gap),
      y: bestTop,
    };
  });
}

export type Circle = { x: number; y: number; r: number };

/**
 * Greedy circle packing: the first circle sits at the origin and each next
 * one takes the first free spot along an outward spiral, so earlier (more
 * important) circles end up nearest the center.
 */
export function spiralPack(
  radii: readonly number[],
  options: { margin: number; aspect?: number }
): Circle[] {
  const aspect = options.aspect ?? 1.5;
  const placed: Circle[] = [];
  for (const r of radii) {
    if (placed.length === 0) {
      placed.push({ x: 0, y: 0, r });
      continue;
    }
    let angle = 0;
    let distance = 0;
    let spot: Circle | undefined;
    // An Archimedean spiral with roughly constant steps along its arc.
    for (let step = 0; step < 20_000 && !spot; step++) {
      angle += Math.min(0.5, 18 / Math.max(distance, 18));
      distance = 9 * angle;
      const candidate = {
        x: Math.cos(angle) * distance * aspect,
        y: Math.sin(angle) * distance,
        r,
      };
      const overlaps = placed.some(
        (other) =>
          Math.hypot(other.x - candidate.x, other.y - candidate.y) <
          other.r + r + options.margin
      );
      if (!overlaps) spot = candidate;
    }
    placed.push(spot ?? { x: 0, y: 0, r });
  }
  return placed;
}

/** The smallest circle around the origin of a packing that contains it. */
export function enclosingRadius(circles: readonly Circle[]): number {
  return circles.reduce(
    (max, circle) => Math.max(max, Math.hypot(circle.x, circle.y) + circle.r),
    0
  );
}

/** Linear interpolation between `from` and `to` at `t` in [0, 1]. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, t));
}
