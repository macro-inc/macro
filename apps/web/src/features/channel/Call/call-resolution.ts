import type { CallRecord } from '@service-call/client';
import { onCleanup } from 'solid-js';
import { match, P } from 'ts-pattern';

/**
 * Cross-tab fan-out of terminal incoming-call states ("answered"/"ended"), so
 * a ring resolved in one tab stops in every tab even when a background tab
 * missed the one-shot websocket event.
 *
 * Resolutions publish over a BroadcastChannel, with a localStorage `storage`
 * event as fallback for embedded browsers where BroadcastChannel is missing
 * or unreliable. The channel is a hand-rolled module-level singleton rather
 * than `@solid-primitives/broadcast-channel`: the primitive constructs
 * `BroadcastChannel` unguarded (it would throw in exactly the environments
 * the fallback exists for) and ties the channel's lifetime to a reactive
 * owner, while publishes here happen from async owner-less contexts and the
 * subscription registry must outlive any subscribing component.
 */

const CALL_RESOLUTION_CHANNEL = 'macro-call-resolution';
const CALL_RESOLUTION_STORAGE_KEY = 'macro.call-resolution';

export type CallResolution =
  | {
      type: 'answered';
      callId: string;
      answeredBy: string;
    }
  | {
      type: 'ended';
      callId: string;
      channelId: string;
    };

type CallResolutionHandler = (resolution: CallResolution) => void;

const handlers = new Set<CallResolutionHandler>();
const handledResolutionKeys = new Set<string>();
const MAX_HANDLED_RESOLUTIONS = 100;
let broadcastChannel: BroadcastChannel | null | undefined;
let isStorageListenerAttached = false;

function getResolutionKey(resolution: CallResolution) {
  return resolution.type === 'answered'
    ? `${resolution.type}:${resolution.callId}:${resolution.answeredBy}`
    : `${resolution.type}:${resolution.callId}`;
}

function parseCallResolution(value: unknown): CallResolution | null {
  return match(value)
    .with(
      { type: 'answered', callId: P.string, answeredBy: P.string },
      ({ type, callId, answeredBy }) => ({ type, callId, answeredBy })
    )
    .with(
      { type: 'ended', callId: P.string, channelId: P.string },
      ({ type, callId, channelId }) => ({ type, callId, channelId })
    )
    .otherwise(() => null);
}

function emitCallResolution(value: unknown) {
  const resolution = parseCallResolution(value);
  if (!resolution) return;

  const key = getResolutionKey(resolution);
  if (handledResolutionKeys.has(key)) return;
  handledResolutionKeys.add(key);
  if (handledResolutionKeys.size > MAX_HANDLED_RESOLUTIONS) {
    const oldestKey = handledResolutionKeys.values().next().value;
    if (oldestKey) handledResolutionKeys.delete(oldestKey);
  }

  for (const handler of handlers) {
    try {
      handler(resolution);
    } catch (error) {
      console.error('Failed to handle call resolution', error);
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
    broadcastChannel = new BroadcastChannel(CALL_RESOLUTION_CHANNEL);
    broadcastChannel.addEventListener('message', (event) =>
      emitCallResolution(event.data)
    );
  } catch {
    broadcastChannel = null;
  }

  return broadcastChannel;
}

function handleStorage(event: StorageEvent) {
  if (event.key !== CALL_RESOLUTION_STORAGE_KEY || !event.newValue) return;

  try {
    emitCallResolution(JSON.parse(event.newValue));
  } catch {
    // Ignore malformed or stale values from older clients.
  }
}

function attachStorageListener() {
  if (isStorageListenerAttached || typeof window === 'undefined') return;
  window.addEventListener('storage', handleStorage);
  isStorageListenerAttached = true;
}

/**
 * Publishes a terminal incoming-call state to this tab and sibling tabs.
 * BroadcastChannel is the primary transport; localStorage is a fallback for
 * embedded browsers where BroadcastChannel delivery is unreliable.
 */
export function publishCallResolution(resolution: CallResolution) {
  emitCallResolution(resolution);

  try {
    getBroadcastChannel()?.postMessage(resolution);
  } catch {
    // The storage event below remains available as a cross-tab fallback.
  }

  try {
    localStorage.setItem(
      CALL_RESOLUTION_STORAGE_KEY,
      JSON.stringify(resolution)
    );
  } catch {
    // Storage can be disabled in private or embedded browser contexts —
    // there, even reading the `localStorage` global throws (a `typeof` check
    // would not catch that, since the global resolves but its getter throws).
  }
}

/** Subscribes to call resolutions originating locally or in another tab. */
export function subscribeToCallResolutions(handler: CallResolutionHandler) {
  handlers.add(handler);
  getBroadcastChannel();
  attachStorageListener();

  return () => {
    handlers.delete(handler);
  };
}

/**
 * Subscribes to call resolutions for the lifetime of the owning component.
 * Must be called during component setup, mirroring `createCallEventsEffect`.
 */
export function createCallResolutionsEffect(handler: CallResolutionHandler) {
  onCleanup(subscribeToCallResolutions(handler));
}

/**
 * Converts authoritative call-record state into a terminal ring resolution.
 * A historic participant row still counts as answered even if the user has
 * since left while the call remains active.
 */
export function getCallRecordResolution(
  record: Pick<
    CallRecord,
    'callId' | 'channelId' | 'isActive' | 'participants'
  >,
  userId: string
): CallResolution | null {
  if (!record.isActive) {
    return {
      type: 'ended',
      callId: record.callId,
      channelId: record.channelId,
    };
  }

  if (
    record.participants.some((participant) => participant.userId === userId)
  ) {
    return {
      type: 'answered',
      callId: record.callId,
      answeredBy: userId,
    };
  }

  return null;
}
