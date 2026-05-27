import { whenSplitManagerReady } from '@app/signal/splitLayout';
import { ENABLE_CALLKIT } from '@core/constant/featureFlags';
import { isPlatform, isTauri } from '@core/util/platform';
import { notificationServiceClient } from '@service-notification/client';
import type { DeviceType } from '@service-notification/generated/schemas/deviceType';
import { addPluginListener, Channel, invoke } from '@tauri-apps/api/core';
import { onCleanup, onMount } from 'solid-js';
import { joinChannelCall } from './join-channel-call';
import {
  type NativeCallSnapshot,
  nativeCallSnapshot,
  setNativeCallSnapshot,
} from './native-call-state';

// The 'iosvoip' variant exists in the backend but the generated schema has not been
// regenerated to include it yet. Cast until a regeneration picks it up.
const DEVICE_TYPE_IOS_VOIP = 'iosvoip' as DeviceType;

type VoipTokenPayload = { token: string };
type CallAnsweredPayload = { channelId: string };
type CallEndedPayload = { callId: string };
type CallEndedHandler = (payload: CallEndedPayload) => void | Promise<void>;

type ConnectionStatePayload = {
  state: NativeCallSnapshot['connectionState'];
  channelId: NativeCallSnapshot['channelId'] | null;
  callId: NativeCallSnapshot['callId'] | null;
};

type GetActiveCallStateResponse = {
  state: NativeCallSnapshot | null;
};

function applyConnectionState(payload: ConnectionStatePayload) {
  if (
    !payload.channelId ||
    !payload.callId ||
    payload.state === 'disconnected'
  ) {
    setNativeCallSnapshot(null);
    return;
  }
  const snapshot: NativeCallSnapshot = {
    channelId: payload.channelId,
    callId: payload.callId,
    connectionState: payload.state,
  };
  setNativeCallSnapshot(snapshot);
}

const callEndedHandlers: CallEndedHandler[] = [];

/**
 * Registers channel-scoped cleanup for native CallKit end events.
 *
 * `useCallKitSetup` owns the single global Tauri listener, while `useCall()`
 * registers the active channel's leave handler here. If multiple channel UI
 * surfaces are mounted, the most recently registered active handler wins; when
 * it unmounts, the previous active handler becomes available again.
 */
export function registerCallKitCallEndedHandler(
  handler: CallEndedHandler
): () => void {
  if (!ENABLE_CALLKIT) return () => {};
  callEndedHandlers.push(handler);
  return () => {
    const index = callEndedHandlers.lastIndexOf(handler);
    if (index !== -1) callEndedHandlers.splice(index, 1);
  };
}

function getActiveCallEndedHandler(): CallEndedHandler | undefined {
  return callEndedHandlers[callEndedHandlers.length - 1];
}

// Fresh CallKit launches can receive answer events before the router tree mounts.
const SPLIT_MANAGER_READY_TIMEOUT_MS = 15_000;

async function joinChannelCallWhenReady(channelId: string): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const ready = whenSplitManagerReady().then(() => 'ready' as const);
  const timeout = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve('timeout'),
      SPLIT_MANAGER_READY_TIMEOUT_MS
    );
  });
  const outcome = await Promise.race([ready, timeout]);
  clearTimeout(timeoutHandle);
  if (outcome === 'timeout') {
    console.error(
      `[callkit] split manager not ready within ${SPLIT_MANAGER_READY_TIMEOUT_MS}ms; ending CallKit call`
    );
    await endCallKitCall();
    return;
  }
  return joinChannelCall(channelId);
}

/**
 * Sets up CallKit / PushKit integration for iOS.
 *
 * - Registers VoIP tokens with the backend as they arrive from PushKit.
 * - When the user answers via the native incoming-call sheet, navigates to the
 *   channel and joins the call via the existing deep-link flow.
 *
 * Must be mounted once at app startup on iOS (no-op on all other platforms).
 */
export function useCallKitSetup() {
  onMount(() => {
    if (!ENABLE_CALLKIT || !isTauri() || !isPlatform('ios')) return;

    let cleaned = false;
    const unregisters: Array<() => Promise<void>> = [];
    onCleanup(() => {
      cleaned = true;
      unregisters.forEach((u) =>
        u().catch((err) =>
          console.error('[callkit] failed to unregister listener', err)
        )
      );
      unregisters.length = 0;
    });

    function trackListener(
      promise: Promise<{ unregister: () => Promise<void> }>,
      label: string
    ) {
      promise
        .then((l) => {
          if (cleaned) {
            l.unregister().catch((err) =>
              console.error(`[callkit] failed to unregister ${label}`, err)
            );
            return;
          }
          unregisters.push(() => l.unregister());
        })
        .catch((err) =>
          console.error(`[callkit] failed to register ${label}`, err)
        );
    }

    trackListener(
      addPluginListener<VoipTokenPayload>(
        'call-kit',
        'voip-token-updated',
        async ({ token }) => {
          await notificationServiceClient
            .registerDevice({ token, deviceType: DEVICE_TYPE_IOS_VOIP })
            .catch((err) =>
              console.error('[callkit] failed to register VoIP token', err)
            );
        }
      ),
      'voip-token-updated'
    );

    // Drain any VoIP token that arrived from PushKit before the listener above
    // was registered (common on first launch).
    invoke<{ token: string | null }>('plugin:call-kit|get_voip_token')
      .then(({ token }) => {
        if (!token) return;
        return notificationServiceClient
          .registerDevice({ token, deviceType: DEVICE_TYPE_IOS_VOIP })
          .catch((err) =>
            console.error('[callkit] failed to register cached VoIP token', err)
          );
      })
      .catch((err) => console.error('[callkit] get_voip_token failed', err));

    const callAnsweredChannel = new Channel<CallAnsweredPayload>();
    callAnsweredChannel.onmessage = ({ channelId }) => {
      joinChannelCallWhenReady(channelId).catch((err) =>
        console.error('[callkit] joinChannelCallWhenReady failed', err)
      );
    };
    invoke<void>('plugin:call-kit|watch_call_answered', {
      channel: callAnsweredChannel,
    })
      .then(() => {
        if (cleaned) return;
        return invoke<{ channelId: string | null }>(
          'plugin:call-kit|get_pending_answered_call'
        ).then(({ channelId }) => {
          if (channelId)
            joinChannelCallWhenReady(channelId).catch((err) =>
              console.error(
                '[callkit] joinChannelCallWhenReady (pending drain) failed',
                err
              )
            );
        });
      })
      .catch((err) =>
        console.error('[callkit] watch_call_answered failed', err)
      );

    const callEndedChannel = new Channel<CallEndedPayload>();
    callEndedChannel.onmessage = (payload) => {
      const handler = getActiveCallEndedHandler();
      if (!handler) return;
      Promise.resolve(handler(payload)).catch((err) =>
        console.error('[callkit] failed to handle ended call', err)
      );
    };
    invoke<void>('plugin:call-kit|watch_call_ended', {
      channel: callEndedChannel,
    }).catch((err) => console.error('[callkit] watch_call_ended failed', err));

    trackListener(
      addPluginListener<ConnectionStatePayload>(
        'call-kit',
        'connection-state',
        applyConnectionState
      ),
      'connection-state'
    );

    // Do not let a stale startup drain overwrite live listener state.
    invoke<GetActiveCallStateResponse>('plugin:call-kit|get_active_call_state')
      .then(({ state }) => {
        if (nativeCallSnapshot() !== null) return;
        if (!state) return;
        setNativeCallSnapshot({
          channelId: state.channelId,
          callId: state.callId,
          connectionState: state.connectionState,
        });
      })
      .catch((err) =>
        console.error('[callkit] get_active_call_state failed', err)
      );
  });
}

/**
 * Tells CallKit to end the active call session.
 *
 * Call this from `leaveCall()` so the native system call UI is dismissed when
 * the user leaves from within the app rather than from the CallKit sheet.
 */
export async function endCallKitCall(): Promise<void> {
  if (!ENABLE_CALLKIT || !isTauri() || !isPlatform('ios')) return;
  await invoke('plugin:call-kit|end_active_call').catch((err) =>
    console.error('[callkit] failed to end active call', err)
  );
}
