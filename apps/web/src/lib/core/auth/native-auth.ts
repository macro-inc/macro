import { getNativeMobilePlatform } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';

export type NativeAuthResult = {
  success: boolean;
  token?: string;
  error?: string;
};

/**
 * Where the hosted flow sends the desktop app's session code. The deep-link
 * bridge turns `macro:///login?token=...` into a `/login` router navigation,
 * and that route redeems the code — so it is pinned here rather than derived
 * from the page the user signed in from, which is usually `/welcome` and
 * ignores the code entirely.
 */
export const DESKTOP_AUTH_CALLBACK_URL = 'macro:///login';

/**
 * Hand the hosted flow to the system browser. Unlike the mobile sheet this
 * never resolves with a token: the desktop shell has no in-app browser, so
 * the session code comes back out-of-band through the `macro://` deep link.
 * Success here only means the browser was launched.
 */
export async function openDesktopAuthSession(
  authUrl: string
): Promise<NativeAuthResult> {
  try {
    await invoke('plugin:opener|open_url', { url: authUrl });
    return { success: true };
  } catch {
    // Mirrors createNativeAuthSession: a bridge failure settles the caller
    // instead of leaving the sign-in button spinning.
    return { success: false, error: 'Unable to start authentication' };
  }
}

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
