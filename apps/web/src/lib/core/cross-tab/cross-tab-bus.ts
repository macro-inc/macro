/**
 * Minimal cross-tab message bus: BroadcastChannel is the primary transport,
 * with a localStorage `storage` event as fallback for embedded browsers
 * where BroadcastChannel is missing or unreliable.
 *
 * This is fan-out only — every subscribing tab sees every message. For a
 * long-lived "exactly one tab owns this job" responsibility use the
 * lock-based election in `tab-leader.ts` instead; an election that needs
 * custom ranking or mid-flight takeover builds its own protocol on this bus
 * (see `features/channel/Call/ring-coordination.ts`).
 *
 * Hand-rolled rather than `@solid-primitives/broadcast-channel`: the
 * primitive constructs `BroadcastChannel` unguarded (it would throw in
 * exactly the environments the fallback exists for) and ties the channel's
 * lifetime to a reactive owner, while publishes happen from async owner-less
 * contexts and the subscriber registry must outlive any subscribing
 * component.
 *
 * Caveat of the storage fallback: writing a byte-identical value does not
 * mutate storage, so the browser fires no `storage` event for it. Messages
 * that are re-published verbatim (e.g. heartbeats) must carry a field, such
 * as a fresh timestamp, that makes every publish unique.
 */

import { evictOldest } from '@core/util/evictOldest';

const MAX_HANDLED_MESSAGE_KEYS = 100;

export type CrossTabBus<TMessage> = {
  /** Delivers a message to this tab's subscribers and to sibling tabs. */
  publish: (message: TMessage) => void;
  /**
   * Subscribes to messages originating locally or in another tab. Returns
   * an unsubscribe function.
   */
  subscribe: (handler: (message: TMessage) => void) => () => void;
};

export function createCrossTabBus<TMessage>(options: {
  /** BroadcastChannel name shared by every tab on the origin. */
  channelName: string;
  /** localStorage key backing the fallback transport. */
  storageKey: string;
  /** Validates and narrows a raw payload; return null to drop it. */
  parse: (value: unknown) => TMessage | null;
  /**
   * Optional dedup key. A message whose key was already handled is dropped
   * (LRU-bounded), so one publish delivered by both transports is handled
   * once. Omit for buses whose handlers are idempotent on repeat delivery.
   */
  getMessageKey?: (message: TMessage) => string;
}): CrossTabBus<TMessage> {
  const { channelName, storageKey, parse, getMessageKey } = options;

  const handlers = new Set<(message: TMessage) => void>();
  const handledMessageKeys = new Set<string>();
  let broadcastChannel: BroadcastChannel | null | undefined;
  let isStorageListenerAttached = false;

  function emit(value: unknown) {
    const message = parse(value);
    if (!message) return;

    if (getMessageKey) {
      const key = getMessageKey(message);
      if (handledMessageKeys.has(key)) return;
      handledMessageKeys.add(key);
      evictOldest(handledMessageKeys, MAX_HANDLED_MESSAGE_KEYS);
    }

    for (const handler of handlers) {
      try {
        handler(message);
      } catch (error) {
        console.error(`Failed to handle ${channelName} message`, error);
      }
    }
  }

  function getBroadcastChannel() {
    if (broadcastChannel !== undefined) return broadcastChannel;
    if (typeof BroadcastChannel === 'undefined') {
      broadcastChannel = null;
      return broadcastChannel;
    }

    try {
      broadcastChannel = new BroadcastChannel(channelName);
      broadcastChannel.addEventListener('message', (event) => emit(event.data));
    } catch {
      broadcastChannel = null;
    }

    return broadcastChannel;
  }

  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey || !event.newValue) return;

    try {
      emit(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed or stale values from older clients.
    }
  }

  function attachStorageListener() {
    if (isStorageListenerAttached || typeof window === 'undefined') return;
    window.addEventListener('storage', handleStorage);
    isStorageListenerAttached = true;
  }

  function publish(message: TMessage) {
    emit(message);

    try {
      getBroadcastChannel()?.postMessage(message);
    } catch {
      // The storage write below remains available as a cross-tab fallback.
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(message));
    } catch {
      // Storage can be disabled in private or embedded browser contexts —
      // there, even reading the `localStorage` global throws (a `typeof`
      // check would not catch that, since the global resolves but its
      // getter throws).
    }
  }

  function subscribe(handler: (message: TMessage) => void) {
    handlers.add(handler);
    getBroadcastChannel();
    attachStorageListener();

    return () => {
      handlers.delete(handler);
    };
  }

  return { publish, subscribe };
}
