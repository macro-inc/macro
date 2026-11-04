/**
 * Background unread presence is refetched by notification patches, activity
 * pushes, reconnects and cache recovery. Each trigger is right to ask, but
 * together they can repeat one request many times a second from a single tab,
 * and every request runs several replica queries. Identical requests share one
 * fetch, and a new one starts at most once per interval.
 */
const COALESCED_OPERATIONS = ['HomeUnreadPresence'];

export const PRESENCE_REQUEST_INTERVAL_MS = 2_000;

type Slot = {
  running?: Promise<Response>;
  queued?: Promise<Response>;
  startedAt: number;
};

type Send = (init: RequestInit | undefined) => Promise<Response>;

function coalescingKey(init: RequestInit | undefined): string | undefined {
  const body = init?.body;
  if (typeof body !== 'string') return undefined;
  return COALESCED_OPERATIONS.some((name) =>
    body.includes(`"operationName":"${name}"`)
  )
    ? body
    : undefined;
}

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | null | undefined
): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export function createPresenceRequestCoalescer(
  intervalMs = PRESENCE_REQUEST_INTERVAL_MS,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
) {
  const slots = new Map<string, Slot>();

  const start = (slot: Slot, send: Send, init: RequestInit | undefined) => {
    const startedAt = now();
    slot.startedAt = startedAt;
    slot.running = (async () => {
      try {
        return await send(init);
      } finally {
        if (slot.startedAt === startedAt) slot.running = undefined;
      }
    })();
    return slot.running;
  };

  const startQueued = async (slot: Slot, send: Send, init: RequestInit) => {
    try {
      await slot.running;
    } catch {
      // The queued request runs whether or not the previous one failed.
    }
    const delay = slot.startedAt + intervalMs - now();
    if (delay > 0) await wait(delay);
    slot.queued = undefined;
    return start(slot, send, init);
  };

  const shared = async (slot: Slot) => {
    if (!slot.queued) throw new Error('presence request was not queued');
    return (await slot.queued).clone();
  };

  return (init: RequestInit | undefined, send: Send): Promise<Response> => {
    const key = coalescingKey(init);
    if (key === undefined) return send(init);
    for (const [other, slot] of slots) {
      if (!slot.running && !slot.queued && now() - slot.startedAt > intervalMs)
        slots.delete(other);
    }
    let slot = slots.get(key);
    if (!slot) {
      slot = { startedAt: -Infinity };
      slots.set(key, slot);
    }
    if (!slot.running && !slot.queued && now() - slot.startedAt >= intervalMs) {
      return start(slot, send, init);
    }
    if (!slot.queued) {
      // Shared by every caller that joins, so no single caller's signal may
      // cancel it; each caller still stops waiting on its own abort.
      const { signal: _signal, ...sharedInit } = init ?? {};
      slot.queued = startQueued(slot, send, sharedInit);
    }
    return abortable(shared(slot), init?.signal);
  };
}
