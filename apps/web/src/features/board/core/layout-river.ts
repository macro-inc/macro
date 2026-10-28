import type { Bounds, Size } from './camera';
import {
  BOARD_ZONES,
  type BoardItem,
  type BoardZone,
  compareByUrgency,
} from './item';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The river's time breaks, newest first. Each gap between two breaks gets
 * the same width, so the last hour reads as wide as the last week.
 */
export const RIVER_BREAKS_MS = [
  0,
  15 * MINUTE,
  HOUR,
  3 * HOUR,
  8 * HOUR,
  DAY,
  3 * DAY,
  7 * DAY,
  30 * DAY,
] as const;

export const RIVER_SEGMENT = 360;
export const RIVER_CHIP_WIDTH = 252;
const ROW_GAP = 10;
const CHIP_GAP = 14;
export const RIVER_LANE_HEADER = 40;
/** Room left of the oldest chip for a lane's name. */
export const RIVER_LANE_LABEL = 180;
/** Room above the lanes for the time axis. */
export const RIVER_AXIS_HEIGHT = 56;
const LANE_PADDING = 16;
const LANE_GAP = 20;

/** World x of a moment `ageMs` before now: 0 is now, the past runs left. */
export function riverX(ageMs: number): number {
  const age = Math.max(0, ageMs);
  for (let index = 0; index < RIVER_BREAKS_MS.length - 1; index++) {
    const from = RIVER_BREAKS_MS[index];
    const to = RIVER_BREAKS_MS[index + 1];
    if (age < to) {
      return -(index + (age - from) / (to - from)) * RIVER_SEGMENT;
    }
  }
  return -(RIVER_BREAKS_MS.length - 1) * RIVER_SEGMENT;
}

export type RiverLane = {
  zone: BoardZone;
  y: number;
  height: number;
  count: number;
};

export type RiverLayout = {
  chips: ReadonlyMap<string, Bounds>;
  lanes: RiverLane[];
  /** Where each break sits, for the time axis. */
  ticks: { ageMs: number; x: number }[];
  bounds: Bounds | undefined;
};

export function estimateChipHeight(item: BoardItem): number {
  const text = item.messages.at(-1)?.text ?? '';
  return 58 + Math.min(2, Math.ceil(Math.max(1, text.length) / 34)) * 18;
}

/**
 * V1C. One lane per neighborhood; each item is a chip whose right edge
 * points at its latest activity. Chips that would collide stack into rows
 * within their lane, newest first.
 */
export function layoutRiver(
  items: readonly BoardItem[],
  now: number,
  measured: (key: string) => Size | undefined
): RiverLayout {
  const chips = new Map<string, Bounds>();
  const lanes: RiverLane[] = [];
  let laneTop = 0;

  for (const zone of BOARD_ZONES) {
    const members = items
      .filter((item) => item.zone === zone)
      .sort(
        (a, b) => b.lastActivityAt - a.lastActivityAt || compareByUrgency(a, b)
      );
    if (members.length === 0) continue;

    // Each row remembers the left edge of its last (older) chip.
    const rows: { left: number; height: number; keys: string[] }[] = [];
    const spans = new Map<string, { left: number; height: number }>();
    for (const item of members) {
      const right = riverX(now - item.lastActivityAt);
      const left = right - RIVER_CHIP_WIDTH;
      const height = measured(item.key)?.height ?? estimateChipHeight(item);
      spans.set(item.key, { left, height });
      const row = rows.find((candidate) => right + CHIP_GAP <= candidate.left);
      if (row) {
        row.left = left;
        row.height = Math.max(row.height, height);
        row.keys.push(item.key);
      } else {
        rows.push({ left, height, keys: [item.key] });
      }
    }

    let rowTop = laneTop + RIVER_LANE_HEADER;
    for (const row of rows) {
      for (const key of row.keys) {
        const span = spans.get(key);
        if (!span) continue;
        chips.set(key, {
          x: span.left,
          y: rowTop,
          width: RIVER_CHIP_WIDTH,
          height: span.height,
        });
      }
      rowTop += row.height + ROW_GAP;
    }

    const height = rowTop - ROW_GAP + LANE_PADDING - laneTop;
    lanes.push({ zone, y: laneTop, height, count: members.length });
    laneTop += height + LANE_GAP;
  }

  // Frame what is on the river, from its oldest chip to just past now.
  const left = Math.min(
    -RIVER_SEGMENT,
    ...[...chips.values()].map((chip) => chip.x)
  );
  return {
    chips,
    lanes,
    ticks: RIVER_BREAKS_MS.map((ageMs) => ({ ageMs, x: riverX(ageMs) })),
    bounds:
      lanes.length === 0
        ? undefined
        : {
            x: left - RIVER_LANE_LABEL,
            y: -RIVER_AXIS_HEIGHT,
            width: -left + RIVER_LANE_LABEL + 120,
            height: laneTop - LANE_GAP + RIVER_AXIS_HEIGHT,
          },
  };
}
