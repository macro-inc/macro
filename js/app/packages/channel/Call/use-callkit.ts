import { isPlatform, isTauri } from '@core/util/platform';
import { notificationServiceClient } from '@service-notification/client';
import type { DeviceType } from '@service-notification/generated/schemas/deviceType';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { onCleanup, onMount } from 'solid-js';
import { joinChannelCall } from './join-channel-call';

// The 'iosvoip' variant exists in the backend but the generated schema has not been
// regenerated to include it yet. Cast until a regeneration picks it up.
const DEVICE_TYPE_IOS_VOIP = 'iosvoip' as DeviceType;

type VoipTokenPayload = { token: string };
type CallAnsweredPayload = { channelId: string };
type CallEndedPayload = { callId: string };
type CallEndedHandler = (payload: CallEndedPayload) => void | Promise<void>;

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
  callEndedHandlers.push(handler);
  return () => {
    const index = callEndedHandlers.lastIndexOf(handler);
    if (index !== -1) callEndedHandlers.splice(index, 1);
  };
}

function getActiveCallEndedHandler(): CallEndedHandler | undefined {
  return callEndedHandlers[callEndedHandlers.length - 1];
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
    if (!isTauri() || !isPlatform('ios')) return;

    let cleaned = false;
    const unlistens: Array<() => void> = [];
    onCleanup(() => {
      cleaned = true;
      unlistens.forEach((u) => u());
    });

    // If cleanup runs before a listen() promise resolves, the unlisten arrives
    // too late to be caught by the forEach above — call it immediately instead.
    function track(p: Promise<() => void>) {
      p.then((u) => {
        if (cleaned) u();
        else unlistens.push(u);
      });
    }

    track(
      listen<VoipTokenPayload>(
        'plugin:call-kit:voip-token-updated',
        async (event) => {
          const { token } = event.payload;
          await notificationServiceClient
            .registerDevice({ token, deviceType: DEVICE_TYPE_IOS_VOIP })
            .catch((err) =>
              console.error('callkit: failed to register VoIP token', err)
            );
        }
      )
    );

    track(
      listen<CallAnsweredPayload>('plugin:call-kit:call-answered', (event) => {
        const { channelId } = event.payload;
        joinChannelCall(channelId).catch((err) =>
          console.error('callkit: failed to join channel call', err)
        );
      })
    );

    track(
      listen<CallEndedPayload>('plugin:call-kit:call-ended', (event) => {
        const handler = getActiveCallEndedHandler();
        if (!handler) return;
        Promise.resolve(handler(event.payload)).catch((err) =>
          console.error('callkit: failed to handle ended call', err)
        );
      })
    );

    // Drain any VoIP token that arrived from PushKit before the listener above
    // was registered (common on first launch).
    invoke<{ token: string | null }>('plugin:call-kit|get_voip_token')
      .then(({ token }) => {
        if (!token) return;
        return notificationServiceClient
          .registerDevice({ token, deviceType: DEVICE_TYPE_IOS_VOIP })
          .catch((err) =>
            console.error('callkit: failed to register cached VoIP token', err)
          );
      })
      .catch((err) => console.error('callkit: get_voip_token failed', err));
  });
}

/**
 * Tells CallKit to end the active call session.
 *
 * Call this from `leaveCall()` so the native system call UI is dismissed when
 * the user leaves from within the app rather than from the CallKit sheet.
 */
export async function endCallKitCall(): Promise<void> {
  if (!isTauri() || !isPlatform('ios')) return;
  await invoke('plugin:call-kit|end_active_call').catch((err) =>
    console.error('callkit: failed to end active call', err)
  );
}
