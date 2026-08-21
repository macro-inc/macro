import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import type { CallRecord } from '@service-call/client';
import { onCleanup } from 'solid-js';
import { match, P } from 'ts-pattern';

/**
 * Cross-tab fan-out of terminal incoming-call states ("answered"/"ended"), so
 * a ring resolved in one tab stops in every tab even when a background tab
 * missed the one-shot websocket event.
 *
 * Resolutions publish over the shared cross-tab bus — see `cross-tab-bus.ts`
 * for the transport (BroadcastChannel with a localStorage `storage` event
 * fallback) and the rationale for hand-rolling it.
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

const callResolutionBus = createCrossTabBus<CallResolution>({
  channelName: CALL_RESOLUTION_CHANNEL,
  storageKey: CALL_RESOLUTION_STORAGE_KEY,
  parse: parseCallResolution,
  getMessageKey: getResolutionKey,
});

/**
 * Publishes a terminal incoming-call state to this tab and sibling tabs.
 * BroadcastChannel is the primary transport; localStorage is a fallback for
 * embedded browsers where BroadcastChannel delivery is unreliable.
 */
export function publishCallResolution(resolution: CallResolution) {
  callResolutionBus.publish(resolution);
}

/** Subscribes to call resolutions originating locally or in another tab. */
export function subscribeToCallResolutions(handler: CallResolutionHandler) {
  return callResolutionBus.subscribe(handler);
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
