/**
 * Broadcasts a writer's cursor/selection over Loro awareness so it shows up as a
 * live remote cursor in the website. The executor pumps each `Awareness` step
 * into `apply()`; unlike the old `presence.ts`, there's no internal timing here —
 * the drag-select and typing motion are decomposed into discrete awareness/pause
 * steps upstream, so this just resolves a node id → its `LoroText`, encodes a
 * cursor at the offset, and sends. Each writer gets its own source (distinct
 * name + color → distinct peer → distinct cursor).
 */

import type { Mirror } from '@loro-mirror/core';
import type { MarkdownLoroSchemaType } from '@macro-inc/lexical-core/markdown-loro-schema';
import {
  type Container,
  EphemeralStore,
  type LoroDoc,
  type LoroMap,
  type LoroText,
} from 'loro-crdt';
import { match } from 'ts-pattern';
import type { Awareness } from '../queue';

export const AI_NAMES = [
  'Wolf',
  'Teo',
  'Julia',
  'Seamus',
  'Evan',
  'Gab',
  'Austin',
  'Peter',
  'Sean',
  'Eric',
  'Jacob',
  'Aiden',
  'Hutch',
].map((n) => `${n} (AI)`);
/** Palette names must resolve to `--color-<name>` (see collaboration/color.ts). */
export const COLORS = ['cyan', 'red', 'yellow', 'green', 'violet', 'pink'];

/** How long the cursor lingers after a writer finishes before it disappears. */
const LINGER_MS = 700;
const KEEPALIVE_MS = 2_000;

export interface AwarenessSource {
  apply(x: Awareness): void;
  clear(): void;
}

/** Records every applied `Awareness` and never touches Loro — for tests. */
export function mockAwarenessSource(): AwarenessSource & { seen: Awareness[] } {
  const seen: Awareness[] = [];
  return {
    seen,
    apply: (x) => void seen.push(x),
    clear: () => {
      seen.length = 0;
    },
  };
}

type EncodedCursorPoint = { nodeId: string; cursor: Uint8Array };
type AwarenessPayload = {
  user: { userId: string; color: string; peerId: string };
  selection: { anchor: EncodedCursorPoint; focus: EncodedCursorPoint };
};

export type RealAwarenessOptions = {
  mirror: Mirror<MarkdownLoroSchemaType>;
  doc: LoroDoc;
  send: (bytes: Uint8Array) => void;
  name: string;
  color: string;
};

export function realAwarenessSource(
  opts: RealAwarenessOptions
): AwarenessSource {
  const { mirror, doc, send, name, color } = opts;
  const store = new EphemeralStore<Record<string, AwarenessPayload>>(30_000);
  const peerKey = crypto.randomUUID();
  let lingerTimer: ReturnType<typeof setTimeout> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let lastAwareness: Awareness | null = null;
  let shown = false;

  function stopKeepalive(): void {
    if (!keepaliveTimer) return;
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }

  function deletePresence(): void {
    stopKeepalive();
    store.delete(peerKey);
    send(store.encodeAll());
    shown = false;
    lastAwareness = null;
  }

  function startKeepalive(): void {
    if (keepaliveTimer) return;
    keepaliveTimer = setInterval(() => {
      if (!lastAwareness || !shown) {
        stopKeepalive();
        return;
      }
      if (!publish(lastAwareness, false)) deletePresence();
    }, KEEPALIVE_MS);
  }

  function setRange(
    nodeId: string,
    text: LoroText,
    a: number,
    b: number
  ): boolean {
    if (lingerTimer) {
      clearTimeout(lingerTimer);
      lingerTimer = null;
    }
    const len = text.length;
    const anchor = text.getCursor(Math.max(0, Math.min(a, len)));
    const focus = text.getCursor(Math.max(0, Math.min(b, len)));
    if (!anchor || !focus) return false;
    store.set(peerKey, {
      user: { userId: name, color, peerId: peerKey },
      selection: {
        anchor: { nodeId, cursor: anchor.encode() },
        focus: { nodeId, cursor: focus.encode() },
      },
    });
    shown = true;
    send(store.encodeAll());
    return true;
  }

  function publish(x: Awareness, keepalive: boolean): boolean {
    // Resolve to the node that actually OWNS the text (a block's text lives in a
    // child text-node container). The cursor blob must be tagged with that id, or
    // the receiver can't map the Loro cursor to a caret and it never walks.
    const owner = resolveTextOwner(mirror, doc, x.node);
    if (!owner) return false;
    const { text, nodeId: ownerNodeId } = owner;
    const didPublish = match(x)
      .with({ type: 'cursor' }, ({ at = 0 }) =>
        setRange(ownerNodeId, text, at, at)
      )
      .with({ type: 'highlight' }, ({ span }) =>
        setRange(ownerNodeId, text, span?.start ?? 0, span?.end ?? text.length)
      )
      .exhaustive();
    if (didPublish && keepalive) startKeepalive();
    return didPublish;
  }

  function apply(x: Awareness): void {
    lastAwareness = x;
    if (!publish(x, true)) {
      if (shown) deletePresence();
      lastAwareness = null;
    }
  }

  function clear(): void {
    if (!shown) return;
    stopKeepalive();
    if (lingerTimer) return;
    lingerTimer = setTimeout(() => {
      lingerTimer = null;
      deletePresence();
    }, LINGER_MS);
  }

  return { apply, clear };
}

// the following functions smell; their role is just to help us find a loro node
// given a stable id and then get the actual lorotext that we can use for
// awareness. there's probably a better way to do this

function isLoroMap(c: Container | undefined): c is LoroMap {
  return c?.kind() === 'Map';
}

/** The `$.id` of a loro container. */
function containerId(c: LoroMap): string | undefined {
  const dollar = c.get('$') as
    | { getShallowValue?: () => { id?: string } | undefined; id?: string }
    | undefined;
  return dollar && typeof dollar.getShallowValue === 'function'
    ? dollar.getShallowValue()?.id
    : dollar?.id;
}

/**
 * Resolve a node id to its `LoroText` AND the id of the container that owns that
 * text. A block's text lives in a child text-node container, so for a block id we
 * return the child text node's id — the awareness blob must be tagged with the
 * text-owning node's id, otherwise the receiver can't turn the Loro cursor into a
 * caret and it never walks with the typed text.
 */
export function resolveTextOwner(
  mirror: Mirror<MarkdownLoroSchemaType>,
  doc: LoroDoc,
  nodeId: string
): { text: LoroText; nodeId: string } | null {
  for (const cid of mirror.getContainerIds()) {
    const c = doc.getContainerById(cid);
    if (!isLoroMap(c)) continue;
    if (containerId(c) !== nodeId) continue;
    const own = ownText(c);
    if (own) return own;
    return firstDescendantText(c);
  }
  return null;
}

/** The container's own `{ text, nodeId }` if it directly holds a LoroText. */
function ownText(c: LoroMap): { text: LoroText; nodeId: string } | null {
  const text = c.get('text') as { kind?: () => string } | undefined;
  const nodeId = containerId(c);
  return text?.kind?.() === 'Text' && nodeId
    ? { text: text as unknown as LoroText, nodeId }
    : null;
}

/** First descendant (DFS) that directly owns a LoroText. */
function firstDescendantText(
  c: LoroMap
): { text: LoroText; nodeId: string } | null {
  const children = c.get('children') as
    | { toArray?: () => Array<Container | undefined> }
    | undefined;
  if (!children || typeof children.toArray !== 'function') return null;
  for (const child of children.toArray()) {
    if (!isLoroMap(child)) continue;
    const own = ownText(child);
    if (own) return own;
    const deep = firstDescendantText(child);
    if (deep) return deep;
  }
  return null;
}
