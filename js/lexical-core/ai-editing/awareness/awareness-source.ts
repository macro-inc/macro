/**
 * Broadcasts a writer's cursor/selection over Loro awareness so it shows up as a
 * live remote cursor in the website. The executor pumps each `Awareness` step
 * into `apply()`; unlike the old `presence.ts`, there's no internal timing here —
 * the drag-select and typing motion are decomposed into discrete awareness/pause
 * steps upstream, so this just resolves a node id → its `LoroText`, encodes a
 * cursor at the offset, and sends. Each writer gets its own source (distinct
 * name + color → distinct peer → distinct cursor).
 */
import { EphemeralStore, type LoroDoc, type LoroText } from 'loro-crdt';
import { match } from 'ts-pattern';
import type { Mirror } from '../../../loro-mirror/packages/core/src';
import type { Awareness } from '../queue/types';

export const AI_NAMES = [
  'Sam', 'Alex', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Quinn', 'Drew', 'Taylor', 'Avery',
  'Reese', 'Skyler', 'Rowan', 'Emerson', 'Finley', 'Hayden', 'Parker', 'Sawyer', 'Blake', 'Cameron',
  'Dakota', 'Elliot', 'Harper', 'Kai',
].map((n) => `${n} (AI)`);
/** Palette names must resolve to `--color-<name>` (see collaboration/color.ts). */
export const COLORS = ['accent-210', 'accent-30', 'accent-90', 'accent-150', 'accent-270', 'accent-330'];

/** Re-send under the receiver's awareness TTL or the cursor blinks out. */
const RESEND_MS = 2_000;

export interface AwarenessSource {
  apply(x: Awareness): void;
  clear(): void;
}

/** Records every applied `Awareness` and never touches Loro — for tests. */
export function mockAwarenessSource(): AwarenessSource & { seen: Awareness[] } {
  const seen: Awareness[] = [];
  return { seen, apply: (x) => void seen.push(x), clear: () => void (seen.length = 0) };
}

export type RealAwarenessOptions = {
  mirror: Mirror<any>;
  doc: LoroDoc;
  send: (bytes: Uint8Array) => void;
  name: string;
  color: string;
};

export function realAwarenessSource(opts: RealAwarenessOptions): AwarenessSource {
  const { mirror, doc, send, name, color } = opts;
  const store = new EphemeralStore(30_000);
  // ONE caret per writer that MOVES, not one-per-node. A single stable key means
  // each `setRange` overwrites the same entry, so the cursor jumps to wherever the
  // writer is now and leaves no stale cursors behind (the old per-node keying left
  // a lingering same-named cursor at every node a writer ever touched). A UUID — not
  // a per-process counter — so keys never collide across sessions/reconnects in a room.
  const peerKey = crypto.randomUUID();
  let timer: ReturnType<typeof setInterval> | null = null;
  let shown = false; // whether this writer's caret was ever broadcast

  function setRange(nodeId: string, text: LoroText, a: number, b: number): void {
    const len = text.length;
    const anchor = text.getCursor(clamp(a, len));
    const focus = text.getCursor(clamp(b, len));
    if (!anchor || !focus) return;
    store.set(peerKey, {
      user: { userId: name, color, peerId: peerKey },
      selection: { anchor: { nodeId, cursor: anchor.encode() }, focus: { nodeId, cursor: focus.encode() } },
    } as any);
    shown = true;
    send(store.encodeAll());
    keepAlive();
  }

  function keepAlive(): void {
    if (timer) return;
    timer = setInterval(() => send(store.encodeAll()), RESEND_MS);
  }

  function apply(x: Awareness): void {
    // Resolve to the node that actually OWNS the text (a block's text lives in a
    // child text-node container). The cursor blob must be tagged with that id, or
    // the receiver can't map the Loro cursor to a caret and it never walks.
    const owner = resolveTextOwner(mirror, doc, x.node);
    if (!owner) return; // structural node with no text container — nothing to show
    const { text, id } = owner;
    match(x)
      .with({ type: 'cursor' }, ({ at = 0 }) => setRange(id, text, at, at))
      .with({ type: 'highlight' }, ({ span }) => setRange(id, text, span?.start ?? 0, span?.end ?? text.length))
      .exhaustive();
  }

  function clear(): void {
    if (shown) {
      store.delete(peerKey);
      send(store.encodeAll());
      shown = false;
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { apply, clear };
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(n, max));
}

/** The `$.id` of a loro container (duck-typed: loro classes can come from
 *  multiple bundle copies, so `instanceof` is unreliable). */
function containerId(c: any): string | undefined {
  const dollar = c?.get?.('$');
  return dollar && typeof dollar.getShallowValue === 'function' ? dollar.getShallowValue()?.id : dollar?.id;
}

/**
 * Resolve a node id to its `LoroText` AND the id of the container that owns that
 * text. A block's text lives in a child text-node container, so for a block id we
 * return the child text node's id — the awareness blob must be tagged with the
 * text-owning node's id, otherwise the receiver can't turn the Loro cursor into a
 * caret and it never walks with the typed text.
 */
export function resolveTextOwner(
  mirror: Mirror<any>,
  doc: LoroDoc,
  nodeId: string
): { text: LoroText; id: string } | null {
  for (const cid of mirror.getContainerIds()) {
    const c = doc.getContainerById(cid) as any;
    if (c?.kind?.() !== 'Map') continue;
    if (containerId(c) !== nodeId) continue;
    const own = ownText(c);
    if (own) return own;
    // matched the block but its text lives below — DFS for the first descendant
    // that owns text (covers list item → paragraph → text, table cell → …, etc.).
    return firstDescendantText(c);
  }
  return null;
}

/** The container's own `{ text, id }` if it directly holds a LoroText. */
function ownText(c: any): { text: LoroText; id: string } | null {
  const text = c?.get?.('text');
  const id = containerId(c);
  return text?.kind?.() === 'Text' && id ? { text: text as LoroText, id } : null;
}

/** First descendant (DFS) that directly owns a LoroText. */
function firstDescendantText(container: any): { text: LoroText; id: string } | null {
  const children = container?.get?.('children');
  if (!children || typeof children.toArray !== 'function') return null;
  for (const child of children.toArray()) {
    const own = ownText(child);
    if (own) return own;
    const deep = firstDescendantText(child);
    if (deep) return deep;
  }
  return null;
}
