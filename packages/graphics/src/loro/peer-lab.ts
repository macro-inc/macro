import { createGraphicsEditorFromBackend } from '../core/editor';
import type { GraphicsDocument } from '../core/model';
import { createLoroGraphicsBackend, createLoroSeed } from './backend';
import { createGraphicsPresence, type PresencePacket } from './presence';

/** Disposable two-replica transport. Bytes are queued in memory, never persisted. */
export function createGraphicsPeerLab(seed: GraphicsDocument) {
  const snapshot = createLoroSeed(seed);
  const backends = [
    createLoroGraphicsBackend(snapshot, '1', seed.rootId),
    createLoroGraphicsBackend(snapshot, '2', seed.rootId),
  ] as const;
  const editors = backends.map(createGraphicsEditorFromBackend);
  const awareness = editors.map((editor, index) =>
    createGraphicsPresence(
      editor,
      {
        id: String(index + 1),
        name: index === 0 ? 'Alice' : 'Bob',
        color: index === 0 ? '#c084fc' : '#22d3ee',
      },
      backends[index]!.getClock
    )
  );
  let connected = true;
  let latency = 0;
  let delivered = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let presenceTimer: ReturnType<typeof setTimeout> | undefined;
  const latestPresence = new Map<number, PresencePacket>();
  const queue: { from: number; bytes: Uint8Array }[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const clearPresenceTimer = () => {
    if (presenceTimer !== undefined) clearTimeout(presenceTimer);
    presenceTimer = undefined;
  };
  const flushPresence = () => {
    clearPresenceTimer();
    if (disposed || !connected) return;
    const packets = [...latestPresence];
    latestPresence.clear();
    for (const [from, packet] of packets) awareness[1 - from]!.receive(packet);
  };
  const schedulePresence = () => {
    if (
      !disposed &&
      connected &&
      latestPresence.size &&
      presenceTimer === undefined
    )
      presenceTimer = setTimeout(flushPresence, latency);
  };
  function syncNow() {
    if (disposed) return;
    clearTimer();
    while (queue.length) {
      const message = queue[0]!;
      backends[1 - message.from]!.receive(message.bytes);
      queue.shift();
      delivered++;
    }
    if (connected) flushPresence();
    notify();
  }
  const schedule = () => {
    if (!disposed && connected && queue.length && timer === undefined)
      timer = setTimeout(syncNow, latency);
  };
  const detach = backends.map((backend, from) =>
    backend.subscribeUpdates((bytes) => {
      queue.push({ from, bytes });
      notify();
      schedule();
    })
  );
  const detachPresence = awareness.map((presence, from) =>
    presence.subscribeUpdates((packet) => {
      if (!connected || disposed) return;
      latestPresence.set(from, packet);
      schedulePresence();
    })
  );
  awareness.forEach((presence) => presence.publish());
  return {
    peers: backends.map((backend, index) => ({
      name: index === 0 ? 'Alice' : 'Bob',
      editor: editors[index]!,
      backend,
      presence: awareness[index]!,
    })),
    status: () => ({ connected, latency, pending: queue.length, delivered }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setConnected(value: boolean) {
      if (disposed) return;
      connected = value;
      clearTimer();
      clearPresenceTimer();
      latestPresence.clear();
      awareness.forEach((presence) => presence.setOnline(value));
      schedule();
      notify();
    },
    setLatency(value: number) {
      if (disposed) return;
      latency = Math.max(0, Math.min(2000, value));
      clearTimer();
      clearPresenceTimer();
      schedule();
      schedulePresence();
      notify();
    },
    syncNow,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      clearPresenceTimer();
      detach.forEach((unsubscribe) => unsubscribe());
      detachPresence.forEach((unsubscribe) => unsubscribe());
      awareness.forEach((presence) => presence.dispose());
      editors.forEach((editor) => editor.dispose());
      backends.forEach((backend) => backend.dispose());
      listeners.clear();
      queue.length = 0;
      latestPresence.clear();
    },
  };
}
export type GraphicsPeerLab = ReturnType<typeof createGraphicsPeerLab>;
