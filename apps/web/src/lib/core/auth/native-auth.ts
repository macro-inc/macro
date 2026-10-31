import { getNativeMobilePlatform } from '@core/util/platform';
import { holdAutomaticReload } from '@core/util/reloadForNewerBuild';
import { Telemetry } from '@macro-inc/observability';
import { invoke } from '@tauri-apps/api/core';

export type NativeAuthResult = {
  success: boolean;
  token?: string;
  error?: string;
};

function nativeAuthOutcome(result: NativeAuthResult) {
  if (result.success) return 'success';
  return result.error === 'User canceled login' ? 'canceled' : 'failed';
}

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
    authenticate(authUrl: string): Promise<NativeAuthResult> {
      return Telemetry.span('auth.native_session', async (span) => {
        span.setAttr(
          'auth.native_session.platform',
          android ? 'android' : 'ios'
        );
        // The sheet's result reaches only the JavaScript that opened it, and
        // finishing it can mean leaving the app for a sign-in code. A reload
        // in between throws away a sign-in that succeeded.
        const releaseReloadHold = holdAutomaticReload();
        try {
          const result = await invoke<NativeAuthResult>(
            android
              ? 'plugin:android-auth|authenticate'
              : 'plugin:auth|authenticate',
            {
              payload: android
                ? { authUrl, callbackUrl }
                : { authUrl, callbackScheme: 'macro', ephemeralSession: true },
            }
          );
          span.setAttr(
            'auth.native_session.outcome',
            nativeAuthOutcome(result)
          );
          return result;
        } catch {
          // Bridge failures must settle the caller just like browser cancellation.
          // Do not log callback URLs or session codes.
          span.setAttr('auth.native_session.outcome', 'bridge_failed');
          return { success: false, error: 'Unable to start authentication' };
        } finally {
          releaseReloadHold();
        }
      });
    },
  };
}
