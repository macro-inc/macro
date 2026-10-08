/**
 * Where people are in a shared Illustrator document (published through
 * awareness): the id session they create objects in, what they selected,
 * their pointer, the text they type into, and the part of the canvas they
 * look at. Also who stores the merged file: one person among those who
 * can edit, so versions are not stored once per person.
 */

import type { Point, Rect } from './geometry';

export {
  initials,
  type Version,
  versionCovers,
} from '@app/features/block-fig/core/presence';

/** One person's presence, as published. */
export type AiPresence = {
  /**
   * The id session (1–4095) this person creates objects in; 0 while they
   * are not in the document.
   */
  session: number;
  /** Ids of the objects they selected. */
  selection: number[];
  /** Pointer in canvas coordinates; `null` when off the canvas. */
  cursor: { x: number; y: number } | null;
  /** Id of the text object they type into. */
  editing: number | null;
  /** Whether they can edit (and so may store the merged file). */
  editor: boolean;
  /** The canvas area they see. */
  view: { x: number; y: number; w: number; h: number } | null;
};

/** Nowhere in the document (a presence that never draws). */
export const NOWHERE: AiPresence = {
  session: 0,
  selection: [],
  cursor: null,
  editing: null,
  editor: false,
  view: null,
};

/** Another person in the document. */
export interface AiPeer {
  peerId: string;
  userId?: string;
  name: string;
  /** A palette color name (`red`, `teal`…). */
  color: string;
  presence: AiPresence;
}

/** Another person, as the canvas overlay draws them. */
export interface PeerOverlay {
  peerId: string;
  name: string;
  /** A CSS color. */
  color: string;
  cursor: Point | null;
  /** Canvas bounds of the objects they selected. */
  selection: Rect[];
  /** Typing into a text object. */
  editing: boolean;
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

const isRect = (v: unknown): v is Rect =>
  isPoint(v) && 'w' in v && 'h' in v && isNumber(v.w) && isNumber(v.h);

/** Whether an awareness value is a presence this app understands. */
export function isPresence(value: unknown): value is AiPresence {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNumber(v.session) &&
    Array.isArray(v.selection) &&
    v.selection.every(isNumber) &&
    (v.cursor === null || isPoint(v.cursor)) &&
    (v.editing === null || isNumber(v.editing)) &&
    typeof v.editor === 'boolean' &&
    (v.view === null || isRect(v.view))
  );
}

/** The largest id session (`ai_engine::collab::MAX_SESSION`). */
export const MAX_SESSION = 4095;

/**
 * A random id session no one present uses. Sessions only have to differ
 * among the people editing at the same time: ids continue after the
 * highest one a session already used.
 */
export function pickSession(
  taken: Iterable<number>,
  random: () => number = Math.random
): number {
  const used = new Set(taken);
  const free =
    MAX_SESSION - [...used].filter((s) => s >= 1 && s <= MAX_SESSION).length;
  if (free <= 0) return 1 + Math.floor(random() * MAX_SESSION);
  // The k-th free session, for a k picked evenly.
  let k = Math.floor(random() * free);
  for (let s = 1; s <= MAX_SESSION; s++) {
    if (used.has(s)) continue;
    if (k === 0) return s;
    k--;
  }
  return MAX_SESSION;
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
  peers: readonly Pick<AiPeer, 'peerId' | 'presence'>[]
): boolean {
  if (!self.editor) return false;
  const mine = peerOrder(self.peerId);
  return peers.every((p) => !p.presence.editor || peerOrder(p.peerId) > mine);
}
