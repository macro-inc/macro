/**
 * Where people are in a shared design (published through awareness): the
 * page, what they selected, their pointer, the text they type into, and
 * the part of the page they look at. Also who stores the merged file:
 * one person among those who can edit, so versions are not stored once
 * per person.
 */

import type { NodeGeometry } from '@core/fig-engine/types';
import type { Point } from './camera';

/** One person's presence, as published. */
export type FigPresence = {
  /** Id of the page they are on. */
  page: string;
  /** Ids of the layers they selected. */
  selection: string[];
  /** Pointer in page coordinates; `null` when off the canvas. */
  cursor: { x: number; y: number } | null;
  /** Id of the text layer they type into. */
  editing: string | null;
  /** Whether they can edit (and so may store the merged file). */
  editor: boolean;
  /** The page area they see, for following them. */
  view: { x: number; y: number; w: number; h: number } | null;
};

/** Another person on the open page, as the canvas overlay draws them. */
export interface PeerOverlay {
  peerId: string;
  name: string;
  /** A CSS color. */
  color: string;
  cursor: Point | null;
  /** Frames of the layers they selected. */
  selection: NodeGeometry[];
  /** Typing into a text layer. */
  editing: boolean;
}

/** Another person in the design. */
export interface FigPeer {
  peerId: string;
  userId?: string;
  name: string;
  /** A palette color name (`red`, `teal`…). */
  color: string;
  presence: FigPresence;
}

const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' &&
  v !== null &&
  'x' in v &&
  'y' in v &&
  isNumber(v.x) &&
  isNumber(v.y);

const isView = (v: unknown): v is NonNullable<FigPresence['view']> =>
  isPoint(v) && 'w' in v && 'h' in v && isNumber(v.w) && isNumber(v.h);

/** Whether an awareness value is a presence this app understands. */
export function isPresence(value: unknown): value is FigPresence {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.page === 'string' &&
    Array.isArray(v.selection) &&
    v.selection.every((id) => typeof id === 'string') &&
    (v.cursor === null || isPoint(v.cursor)) &&
    (v.editing === null || typeof v.editing === 'string') &&
    typeof v.editor === 'boolean' &&
    (v.view === null || isView(v.view))
  );
}

/** Nowhere in the design (a presence that never draws). */
export const NOWHERE: FigPresence = {
  page: '',
  selection: [],
  cursor: null,
  editing: null,
  editor: false,
  view: null,
};

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
  peers: readonly Pick<FigPeer, 'peerId' | 'presence'>[]
): boolean {
  if (!self.editor) return false;
  const mine = peerOrder(self.peerId);
  return peers.every((p) => !p.presence.editor || peerOrder(p.peerId) > mine);
}

/** A Loro version vector as JSON: peer id → operation count. */
export type Version = Record<string, number>;

/** Whether `stored` includes every operation `seen` has. */
export function versionCovers(stored: Version, seen: Version): boolean {
  return Object.entries(seen).every(
    ([peer, count]) => (stored[peer] ?? 0) >= count
  );
}

/** Initials for an avatar. */
export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/** A random guid session for this visit: unique among peers in practice. */
export function newGuidSession(random: () => number = Math.random): number {
  // Above the sessions Figma files use, inside Figma's 32-bit ids.
  const low = 1 << 20;
  return low + Math.floor(random() * (2 ** 31 - low));
}
