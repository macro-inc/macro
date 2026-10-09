import { EphemeralStore } from 'loro-crdt';
import type { GraphicsEditor } from '../core/editor';
import type { Point } from '../core/model';
import {
  capturePresence,
  type PeerPresence,
  type PresenceClock,
  type PresenceIdentity,
} from './presence-state';

export type PresencePacket = {
  from: string;
  sequence: number;
  bytes: Uint8Array;
};
export const PRESENCE_TIMEOUT = 30_000;
export const PRESENCE_DEBOUNCE = 40;
export const PRESENCE_MAX_WAIT = 100;
const HEARTBEAT_INTERVAL = 10_000;

/** Ephemeral channel adapter. It only observes the core and never issues edits. */
export function createGraphicsPresence(
  editor: GraphicsEditor,
  identity: PresenceIdentity,
  clock: () => PresenceClock
) {
  const store = new EphemeralStore<Record<string, PeerPresence>>(
    PRESENCE_TIMEOUT
  );
  const listeners = new Set<() => void>();
  const outgoing = new Set<(packet: PresencePacket) => void>();
  const sequences = new Map<string, number>();
  let sequence = 0;
  let cursor: Point | null = null;
  let online = true;
  let disposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const clearPending = () => {
    clearTimeout(debounceTimer);
    clearTimeout(deadlineTimer);
    debounceTimer = deadlineTimer = undefined;
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const publish = () => {
    clearPending();
    if (disposed || !online) return;
    store.set(identity.id, capturePresence(editor, identity, clock(), cursor));
    const packet = {
      from: identity.id,
      sequence: ++sequence,
      bytes: store.encode(identity.id),
    };
    for (const listener of outgoing) listener(packet);
  };
  // Capture/encode only when sending, not on every pointer or preview event.
  const schedule = () => {
    if (disposed || !online) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(publish, PRESENCE_DEBOUNCE);
    deadlineTimer ??= setTimeout(publish, PRESENCE_MAX_WAIT);
  };
  const observeGesture = () => {
    const session = editor.getSession();
    if (session.transform || session.box || editor.getPreview()) schedule();
    else publish(); // Selection changes, cancellation and release are immediate.
  };
  const detach = [
    editor.subscribeSession(observeGesture),
    editor.subscribePreview(observeGesture),
    editor.subscribeDocument(publish),
    store.subscribe((event) => {
      if (event.by !== 'local') notify();
    }),
  ];
  const heartbeat = setInterval(publish, HEARTBEAT_INTERVAL);
  return {
    identity,
    getClock: clock,
    getRemote: () =>
      online && !disposed
        ? Object.values(store.getAllStates()).filter(
            (value): value is PeerPresence =>
              !!value && value.id !== identity.id
          )
        : [],
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeUpdates(listener: (packet: PresencePacket) => void) {
      outgoing.add(listener);
      return () => {
        outgoing.delete(listener);
      };
    },
    publish,
    setCursor(point: Point | null) {
      if (disposed) return;
      if (point && ![point.x, point.y].every(Number.isFinite)) return;
      if (!point && !cursor) return;
      cursor = point;
      if (point) schedule();
      else publish();
    },
    receive(packet: PresencePacket) {
      if (
        disposed ||
        !online ||
        packet.from === identity.id ||
        packet.sequence <= (sequences.get(packet.from) ?? 0)
      )
        return;
      sequences.set(packet.from, packet.sequence);
      store.apply(packet.bytes);
    },
    setOnline(value: boolean) {
      if (disposed) return;
      online = value;
      clearPending();
      if (!online)
        for (const id of store.keys()) if (id !== identity.id) store.delete(id);
      notify();
      if (online) publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearPending();
      clearInterval(heartbeat);
      detach.forEach((unsubscribe) => unsubscribe());
      store.destroy();
      store.inner.free();
      outgoing.clear();
      listeners.clear();
    },
  };
}
export type GraphicsPresence = ReturnType<typeof createGraphicsPresence>;
