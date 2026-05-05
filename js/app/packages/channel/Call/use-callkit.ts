import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { onCleanup, onMount } from 'solid-js';
import { isPlatform, isTauri } from '@core/util/platform';
import type { DeviceType } from '@service-notification/generated/schemas/deviceType';
import { notificationServiceClient } from '@service-notification/client';
import { joinChannelCall } from './join-channel-call';

// The 'iosvoip' variant exists in the backend but the generated schema has not been
// regenerated to include it yet. Cast until a regeneration picks it up.
const DEVICE_TYPE_IOS_VOIP = 'iosvoip' as DeviceType;

type VoipTokenPayload = { token: string };
type CallAnsweredPayload = { callId: string; channelId: string };

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

    const unlistens: Array<() => void> = [];
    onCleanup(() => unlistens.forEach((u) => u()));

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
    ).then((u) => unlistens.push(u));

    listen<CallAnsweredPayload>(
      'plugin:call-kit:call-answered',
      (event) => {
        const { channelId } = event.payload;
        joinChannelCall(channelId).catch((err) =>
          console.error('callkit: failed to join channel call', err)
        );
      }
    ).then((u) => unlistens.push(u));

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
  await invoke('plugin:call-kit|end_active_call').catch(() => {});
}
