import { getNativeMobilePlatform } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';

export type NativeAuthResult = {
  success: boolean;
  token?: string;
  error?: string;
};

/** Create the callback before asking the backend to construct OAuth state. */
export function createNativeAuthSession(iosCallbackHost: string) {
  const android = getNativeMobilePlatform() === 'android';
  const callbackUrl = android
    ? `macro://android-auth/${crypto.randomUUID()}`
    : `macro://${iosCallbackHost}`;

  return {
    callbackUrl,
    async authenticate(authUrl: string): Promise<NativeAuthResult> {
      try {
        return await invoke<NativeAuthResult>(
          android
            ? 'plugin:android-auth|authenticate'
            : 'plugin:auth|authenticate',
          {
            payload: android
              ? { authUrl, callbackUrl }
              : { authUrl, callbackScheme: 'macro', ephemeralSession: true },
          }
        );
      } catch {
        // Bridge failures must settle the caller just like browser cancellation.
        // Do not log callback URLs or session codes.
        return { success: false, error: 'Unable to start authentication' };
      }
    },
  };
}
