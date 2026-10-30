import { type Bounds, unionBounds } from './camera';
import { lerp, spiralPack } from './geometry';
import { BOARD_ZONES, type BoardItem, type BoardZone, itemHeat } from './item';

export const BUBBLE_MIN_RADIUS = 28;
export const BUBBLE_MAX_RADIUS = 50;

/**
 * Each face owns a cell of a hexagonal lattice, wide enough for its speech
 * bubble to open up and to the right without reaching a neighbor.
 */
export const BUBBLE_CELL_WIDTH = 210;
const CELL_HEIGHT = 200;
/** The face sits low and left in its cell, leaving the bubble room. */
const FACE_OFFSET = { x: -20, y: 18 };
/** From the outermost cell center to the cluster's edge. */
const CLUSTER_PADDING = 120;

/** A face on the board; `x` and `y` are its center. */
export type BubbleNode = { x: number; y: number; r: number };

export type BubbleCluster = {
  zone: BoardZone;
  x: number;
  y: number;
  r: number;
  count: number;
};

export type BubblesLayout = {
  nodes: ReadonlyMap<string, BubbleNode>;
  clusters: BubbleCluster[];
  bounds: Bounds | undefined;
};

export function bubbleRadius(item: BoardItem, now: number): number {
  return lerp(BUBBLE_MIN_RADIUS, BUBBLE_MAX_RADIUS, itemHeat(item, now));
}

const HEX_DIRECTIONS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;

/** The first `count` cells of a hexagonal spiral, center first, in axial coordinates. */
export function hexSpiral(count: number): { q: number; r: number }[] {
  const cells = [{ q: 0, r: 0 }];
  for (let ring = 1; cells.length < count; ring++) {
    let q = HEX_DIRECTIONS[4][0] * ring;
    let r = HEX_DIRECTIONS[4][1] * ring;
    for (const [dq, dr] of HEX_DIRECTIONS) {
      for (let step = 0; step < ring && cells.length < count; step++) {
        cells.push({ q, r });
        q += dq;
        r += dr;
      }
    }
  }
  return cells.slice(0, count);
}

/**
 * V1B. Each neighborhood is an organic cluster of faces on a hexagonal
 * lattice with its loudest conversation in the middle, and clusters pack
 * around Channels at the center of the board.
 */
export function layoutBubbles(
  items: readonly BoardItem[],
  now: number
): BubblesLayout {
  const groups = BOARD_ZONES.flatMap((zone) => {
    const members = items
      .filter((item) => item.zone === zone)
      .map((item) => ({ item, heat: itemHeat(item, now) }))
      .sort(
        (a, b) =>
          b.heat - a.heat || b.item.lastActivityAt - a.item.lastActivityAt
      );
    if (members.length === 0) return [];
    const lattice = hexSpiral(members.length).map(({ q, r }) => ({
      x: BUBBLE_CELL_WIDTH * (q + r / 2),
      y: CELL_HEIGHT * r,
    }));
    // A partly filled ring is lopsided; center the cluster on what it holds.
    const middle = {
      x: lattice.reduce((sum, cell) => sum + cell.x, 0) / lattice.length,
      y: lattice.reduce((sum, cell) => sum + cell.y, 0) / lattice.length,
    };
    const cells = lattice.map((cell) => ({
      x: cell.x - middle.x,
      y: cell.y - middle.y,
    }));
    const reach = Math.max(...cells.map((cell) => Math.hypot(cell.x, cell.y)));
    return [{ zone, members, cells, r: reach + CLUSTER_PADDING }];
  });

  const centers = spiralPack(
    groups.map((group) => group.r),
    { margin: 64, aspect: 1.6 }
  );

  const nodes = new Map<string, BubbleNode>();
  const clusters = groups.map((group, index) => {
    const center = centers[index];
    group.members.forEach((member, memberIndex) => {
      const cell = group.cells[memberIndex];
      nodes.set(member.item.key, {
        x: center.x + cell.x + FACE_OFFSET.x,
        y: center.y + cell.y + FACE_OFFSET.y,
        r: lerp(BUBBLE_MIN_RADIUS, BUBBLE_MAX_RADIUS, member.heat),
      });
    });
    return {
      zone: group.zone,
      x: center.x,
      y: center.y,
      r: group.r,
      count: group.members.length,
    };
  });

  return {
    nodes,
    clusters,
    bounds: unionBounds(
      clusters.map((cluster) => ({
        x: cluster.x - cluster.r,
        y: cluster.y - cluster.r,
        width: cluster.r * 2,
        height: cluster.r * 2,
      }))
    ),
  };
}
