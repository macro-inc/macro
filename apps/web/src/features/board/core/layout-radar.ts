import type { Bounds } from './camera';
import {
  BOARD_ZONES,
  type BoardItem,
  type BoardZone,
  compareByUrgency,
} from './item';

/**
 * Rings from the center out: what asks for the viewer, what is new, what
 * happened today, and everything older.
 */
export const RADAR_RINGS = ['needs-you', 'new', 'today', 'earlier'] as const;

export type RadarRing = (typeof RADAR_RINGS)[number];

export const RADAR_CENTER_RADIUS = 72;
const RING_SPACING = 170;
/**
 * Arc between neighbors on a ring. Names radiate outward and diverge, so
 * inner rings can pack tighter than outer ones.
 */
function nodeSpacing(ring: RadarRing): number {
  return 140 + RADAR_RINGS.indexOf(ring) * 25;
}
const SUBRING_SPACING = 96;
/** Radians left empty at the top, where the rings are named. */
const TOP_GAP = 0.3;

export function radarRingRadius(ring: RadarRing): number {
  return RADAR_CENTER_RADIUS + 110 + RADAR_RINGS.indexOf(ring) * RING_SPACING;
}

export function radarRing(item: BoardItem, now: number): RadarRing {
  if (item.needsYou) return 'needs-you';
  if (item.unreadCount > 0) return 'new';
  if (now - item.lastActivityAt < 24 * 3_600_000) return 'today';
  return 'earlier';
}

/** A node's center and its angle, in radians clockwise from the top. */
export type RadarNode = { x: number; y: number; angle: number };

export type RadarSector = {
  zone: BoardZone;
  /** Radians, clockwise from the top. */
  start: number;
  end: number;
  count: number;
};

export type RadarLayout = {
  nodes: ReadonlyMap<string, RadarNode>;
  sectors: RadarSector[];
  /** The outermost ring a node sits on, for drawing the rings. */
  outerRadius: number;
  bounds: Bounds;
};

/** The angle of a world point around the center, clockwise from the top. */
export function radarAngle(point: { x: number; y: number }): number {
  return Math.atan2(point.x, -point.y);
}

/** Polar to world coordinates, with angle 0 pointing up. */
export function radarPoint(angle: number, radius: number) {
  return {
    x: Math.sin(angle) * radius,
    y: -Math.cos(angle) * radius,
  };
}

/**
 * V1D. The viewer sits at the center. Each neighborhood owns a sector sized
 * by how crowded its rings are; inside a sector, items sit on the ring for
 * their urgency, spilling onto staggered sub-rings when an arc still fills.
 */
export function layoutRadar(
  items: readonly BoardItem[],
  now: number
): RadarLayout {
  const zones = BOARD_ZONES.flatMap((zone) => {
    const members = items.filter((item) => item.zone === zone);
    return members.length ? [{ zone, members }] : [];
  });
  // A sector's share is the angle its most crowded ring needs, so busy
  // kinds of work widen instead of spilling onto extra sub-rings.
  const weights = zones.map(({ members }) =>
    Math.max(
      0.35,
      ...RADAR_RINGS.map(
        (ring) =>
          (members.filter((item) => radarRing(item, now) === ring).length *
            nodeSpacing(ring)) /
          radarRingRadius(ring)
      )
    )
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  const nodes = new Map<string, RadarNode>();
  const sectors: RadarSector[] = [];
  let outerRadius = radarRingRadius('earlier');
  let start = TOP_GAP / 2;

  zones.forEach(({ zone, members }, zoneIndex) => {
    const span = (weights[zoneIndex] / total) * (Math.PI * 2 - TOP_GAP);
    const end = start + span;
    sectors.push({ zone, start, end, count: members.length });

    for (const ring of RADAR_RINGS) {
      const onRing = members
        .filter((item) => radarRing(item, now) === ring)
        .sort(compareByUrgency);
      let placed = 0;
      let subring = 0;
      while (placed < onRing.length) {
        const radius = radarRingRadius(ring) + subring * SUBRING_SPACING;
        // Leave a margin at both sector edges so neighbors do not touch.
        const spacing = nodeSpacing(ring);
        const usable = Math.max(0, span * radius - spacing * 0.6);
        const capacity = Math.max(1, Math.floor(usable / spacing) + 1);
        const batch = onRing.slice(placed, placed + capacity);
        // Alternate sub-rings sit between the faces of the ring inside them,
        // so names radiating outward fall into the gaps.
        const stagger = subring % 2 === 1 ? 0.5 : 0;
        const slots = batch.length + (stagger ? 0.5 : 0);
        batch.forEach((item, index) => {
          const angle = start + span * ((index + 0.5 + stagger / 2) / slots);
          const point = radarPoint(angle, radius);
          nodes.set(item.key, { ...point, angle });
        });
        outerRadius = Math.max(outerRadius, radius);
        placed += batch.length;
        subring += 1;
      }
    }
    start = end;
  });

  // Room past the outer ring for sector names.
  const extent = outerRadius + 200;
  return {
    nodes,
    sectors,
    outerRadius,
    bounds: { x: -extent, y: -extent, width: extent * 2, height: extent * 2 },
  };
}
