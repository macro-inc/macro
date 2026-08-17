import { useCallContextOptional } from '@channel/Call/CallContext';
import {
  MAX_RING_DURATION_MS,
  stopCallRinger,
} from '@channel/Call/CallStartedNotifier';
import { createCallEventsEffect } from '@channel/Call/call-events';
import {
  createCallResolutionsEffect,
  getCallRecordResolution,
  publishCallResolution,
} from '@channel/Call/call-resolution';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { isTabFocused } from '@core/signal/tabFocus';
import { fetchCallRecord } from '@queries/call/call';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';

export type IncomingCall = {
  channelId: string;
  callId: string;
  createdAt: string;
  createdBy: string | null;
};

type DebugIncomingCallOptions = {
  channelId?: string;
  callId?: string;
  createdAt?: string;
  createdBy?: string | null;
};

declare global {
  interface Window {
    macroDebugIncomingCall?: (
      options?: DebugIncomingCallOptions
    ) => IncomingCall | null;
    macroClearDebugIncomingCalls?: () => void;
  }
}

// Module-level so the store outlives any single widget mount — the sidebar that
// renders incoming calls can be hidden while a call is still ringing.
const [incomingCalls, setIncomingCalls] = createSignal<IncomingCall[]>([]);
const incomingCallTimeouts = new Map<string, number>();
const INCOMING_CALL_RECONCILE_INTERVAL_MS = 4_000;

function clearIncomingCallTimeouts() {
  for (const timeoutId of incomingCallTimeouts.values()) {
    window.clearTimeout(timeoutId);
  }
  incomingCallTimeouts.clear();
}

export function dismissIncomingCall(callId: string) {
  stopCallRinger(callId);
  const timeoutId = incomingCallTimeouts.get(callId);
  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId);
    incomingCallTimeouts.delete(callId);
  }
  setIncomingCalls((calls) => calls.filter((call) => call.callId !== callId));
}

function addIncomingCall(call: IncomingCall) {
  const existingTimeoutId = incomingCallTimeouts.get(call.callId);
  if (existingTimeoutId !== undefined) {
    window.clearTimeout(existingTimeoutId);
  }
  incomingCallTimeouts.set(
    call.callId,
    window.setTimeout(
      () => dismissIncomingCall(call.callId),
      MAX_RING_DURATION_MS
    )
  );

  setIncomingCalls((calls) => {
    const withoutDuplicate = calls.filter(
      (candidate) =>
        candidate.callId !== call.callId &&
        candidate.channelId !== call.channelId
    );
    return [call, ...withoutDuplicate].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
}

async function reconcileIncomingCall(call: IncomingCall, userId: string) {
  try {
    // The stale time matches the reconcile interval so overlapping triggers
    // (interval + focus + online) collapse into one request per cycle.
    const record = await fetchCallRecord(
      call.callId,
      INCOMING_CALL_RECONCILE_INTERVAL_MS
    );
    const resolution = getCallRecordResolution(record, userId);
    if (resolution) publishCallResolution(resolution);
  } catch (error) {
    // The websocket and cross-tab transports remain the primary paths. A
    // transient reconciliation failure should not disturb the active ring.
    console.warn('incoming call reconciliation failed', error);
  }
}

export function useVisibleIncomingCalls(): Accessor<IncomingCall[]> {
  const channelsCtx = useChannelsContext();
  const callCtx = useCallContextOptional();

  return createMemo(() => {
    const channelsById = channelsCtx.channelsById();
    const joinedChannelId = callCtx?.isInCall()
      ? callCtx.activeChannelId()
      : null;
    const joinedCallId = callCtx?.isInCall() ? callCtx.activeCallId() : null;

    return incomingCalls()
      .filter((call) => {
        if (!channelsById[call.channelId]) return false;
        return (
          call.channelId !== joinedChannelId && call.callId !== joinedCallId
        );
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  });
}

export function useIncomingCallWidgetVisible() {
  const visibleIncomingCalls = useVisibleIncomingCalls();
  return createMemo(() => visibleIncomingCalls().length > 0);
}

/**
 * Keeps the incoming-call store in sync with the call websocket events.
 *
 * Mount once near the app root, alongside `<CallStartedNotifier />` — *not*
 * inside the sidebar. The store is module-level and per-call auto-dismiss
 * timers bound its growth, so tracking must not be tied to whether the widget
 * that renders it happens to be visible. Instant dismissal on answer/end
 * arrives via call resolutions, which `<CallStartedNotifier />` publishes
 * from the websocket events — without it mounted, dismissal degrades to the
 * reconciliation poll below.
 */
export function IncomingCallEvents() {
  const callCtx = useCallContextOptional();
  const channelsCtx = useChannelsContext();
  const userId = useUserId();

  createCallResolutionsEffect((resolution) => {
    if (resolution.type === 'answered' && resolution.answeredBy !== userId()) {
      return;
    }
    dismissIncomingCall(resolution.callId);
  });

  createEffect(() => {
    if (!DEV_MODE_ENV) return;

    window.macroDebugIncomingCall = (options = {}) => {
      const channelsById = channelsCtx.channelsById();
      const channelId = options.channelId ?? Object.keys(channelsById)[0];

      if (!channelId || !channelsById[channelId]) {
        console.warn(
          '[incoming-call-widget] No cached channel found for debug call',
          options
        );
        return null;
      }

      const call = {
        channelId,
        callId:
          options.callId ??
          `debug-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
        createdAt: options.createdAt ?? new Date().toISOString(),
        createdBy: options.createdBy ?? 'debug',
      };
      addIncomingCall(call);
      return call;
    };

    window.macroClearDebugIncomingCalls = () => {
      clearIncomingCallTimeouts();
      setIncomingCalls([]);
    };

    onCleanup(() => {
      delete window.macroDebugIncomingCall;
      delete window.macroClearDebugIncomingCalls;
    });
  });

  createEffect(() => {
    const activeCallId = callCtx?.activeCallId();
    if (activeCallId) dismissIncomingCall(activeCallId);
  });

  // Dev-only debug calls (`window.macroDebugIncomingCall`) have no server
  // record to reconcile against.
  const reconcilableCalls = createMemo(() =>
    incomingCalls().filter(
      (call) => !(DEV_MODE_ENV && call.callId.startsWith('debug-'))
    )
  );
  const shouldReconcile = createMemo(
    () => reconcilableCalls().length > 0 && !!userId()
  );

  const reconcile = () => {
    const currentUserId = userId();
    if (!currentUserId) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    for (const call of reconcilableCalls()) {
      void reconcileIncomingCall(call, currentUserId);
    }
  };

  // Websocket events are intentionally one-shot and are not replayed after a
  // background tab reconnects. While calls are ringing, periodically compare
  // them with the authoritative call record. Overlapping triggers are deduped
  // by the query cache inside `reconcileIncomingCall`; the boolean memo gate
  // keeps the interval from restarting every time the call set changes.
  createEffect(() => {
    if (!shouldReconcile()) return;

    untrack(reconcile);
    const intervalId = window.setInterval(
      reconcile,
      INCOMING_CALL_RECONCILE_INTERVAL_MS
    );
    window.addEventListener('online', reconcile);

    onCleanup(() => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', reconcile);
    });
  });

  // The interval is throttled while the tab is hidden; re-check as soon as
  // the tab regains focus.
  createEffect(
    on(
      isTabFocused,
      (focused) => {
        if (focused && shouldReconcile()) reconcile();
      },
      { defer: true }
    )
  );

  createCallEventsEffect({
    onCallStarted: ({ channelId, callId, createdBy, isFromSelf }) => {
      if (callCtx?.activeCallId() === callId) return;
      if (isFromSelf) return;

      addIncomingCall({
        channelId,
        callId,
        createdAt: new Date().toISOString(),
        createdBy,
      });
    },
  });

  return null;
}
