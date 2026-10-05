/**
 * Where people are in a shared Photoshop document (published through
 * awareness): their pointer, the layers they work on, their selection's
 * outline, the tool they hold, and the part of the canvas they look at.
 * Also the layer id session each person creates layers in, and who stores
 * the merged file (one person among those who can edit, so versions are
 * not stored once per person).
 */

import type { IRect, SelectionInfo } from '@core/psd-engine/types';
import type { Point } from './selection-math';

export {
  initials,
  type Version,
  versionCovers,
} from '@app/features/block-fig/core/presence';

/**
 * A selection outline as published: polygons of `[x0, y0, x1, y1, …]`.
 * Presence types are plain object types (not interfaces) so they are
 * awareness values.
 */
export type SharedSelection = {
  bounds: { x: number; y: number; w: number; h: number };
  outline: number[][];
};

/** One person's presence, as published. */
export type PsdPresence = {
  /** The layer id session (1–65535) this person creates layers in. */
  session: number;
  /** Pointer in canvas pixels; `null` when off the canvas. */
  cursor: { x: number; y: number } | null;
  /** Ids of the layers they work on (the first is the active one). */
  layers: number[];
  /** Their selection's outline. */
  selection: SharedSelection | null;
  /** The tool they hold. */
  tool: string;
  /** Whether they can edit (and so may store the merged file). */
  editor: boolean;
  /** The canvas area they see, for following them. */
  view: { x: number; y: number; w: number; h: number } | null;
  /** The text layer they type into. */
  editing: number | null;
};

/** Another person in the document. */
export interface PsdPeer {
  peerId: string;
  userId?: string;
  name: string;
  /** A palette color name (`red`, `teal`…). */
  color: string;
  presence: PsdPresence;
}

/** Nowhere in the document (a presence that never draws). */
export const NOWHERE: PsdPresence = {
  session: 0,
  cursor: null,
  layers: [],
  selection: null,
  tool: 'move',
  editor: false,
  view: null,
  editing: null,
};

const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' &&
  v !== null &&
  'x' in v &&
  'y' in v &&
  isNumber(v.x) &&
  isNumber(v.y);

const isRect = (v: unknown): v is IRect =>
  isPoint(v) && 'w' in v && 'h' in v && isNumber(v.w) && isNumber(v.h);

const isSelection = (v: unknown): v is SharedSelection =>
  typeof v === 'object' &&
  v !== null &&
  'bounds' in v &&
  'outline' in v &&
  isRect(v.bounds) &&
  Array.isArray(v.outline) &&
  v.outline.every((p) => Array.isArray(p) && p.every(isNumber));

/** Whether an awareness value is a presence this app understands. */
export function isPresence(value: unknown): value is PsdPresence {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNumber(v.session) &&
    (v.cursor === null || isPoint(v.cursor)) &&
    Array.isArray(v.layers) &&
    v.layers.every(isNumber) &&
    (v.selection === null || isSelection(v.selection)) &&
    typeof v.tool === 'string' &&
    typeof v.editor === 'boolean' &&
    (v.view === null || isRect(v.view)) &&
    (v.editing === null || isNumber(v.editing))
  );
}

/** Points of a published selection outline at most. */
const SHARED_POINTS = 600;

/**
 * A selection's outline for presence: at most `budget` points in all
 * (every k-th point of each polygon), smallest polygons dropped first
 * when even that is too many, coordinates rounded to tenths.
 */
export function shareSelection(
  info: SelectionInfo,
  budget = SHARED_POINTS
): SharedSelection | null {
  if (!info.bounds || info.outline.length === 0) return null;
  const polygons = [...info.outline]
    .filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length);
  const kept: [number, number][][] = [];
  let room = budget;
  for (const p of polygons) {
    if (room < 3) break;
    kept.push(p);
    room -= Math.min(p.length, 3);
  }
  const total = kept.reduce((n, p) => n + p.length, 0);
  const round = (v: number) => Math.round(v * 10) / 10;
  const outline = kept.map((p) => {
    // Each polygon's share of the budget, three points at least.
    const share = Math.max(3, Math.floor((p.length * budget) / total));
    const step = Math.max(1, Math.floor(p.length / share));
    const flat: number[] = [];
    for (let i = 0; i < p.length; i += step)
      flat.push(round(p[i][0]), round(p[i][1]));
    return flat;
  });
  return { bounds: info.bounds, outline };
}

const peerOrder = (id: string): bigint => {
  try {
    return BigInt(id);
  } catch {
    return 0n;
  }
};

/**
 * Whether this person stores the merged file: the editor with the lowest
 * peer id among those present stores it.
 */
export function storesFile(
  self: { peerId: string; editor: boolean },
  peers: readonly Pick<PsdPeer, 'peerId' | 'presence'>[]
): boolean {
  if (!self.editor) return false;
  const mine = peerOrder(self.peerId);
  return peers.every((p) => !p.presence.editor || peerOrder(p.peerId) > mine);
}

/** The largest layer id session (ids are `session << 16 | n` in a u32). */
const MAX_SESSION = 0xffff;

/**
 * A layer id session for this visit: random, and not used by the people
 * present or by layers already shared.
 */
export function chooseSession(
  taken: ReadonlySet<number>,
  random: () => number = Math.random
): number {
  for (let attempt = 0; attempt < 64; attempt++) {
    const session = 1 + Math.floor(random() * MAX_SESSION);
    if (!taken.has(session)) return session;
  }
  for (let session = 1; session <= MAX_SESSION; session++)
    if (!taken.has(session)) return session;
  return 1;
}
