/**
 * Registry connecting the auth lifecycle to push-notification device
 * registration.
 *
 * The backend keys a device token to a single user, so registrations must be
 * rebound on every login and removed on logout — otherwise the device keeps
 * receiving the previous account's pushes. Platform modules (APNs/FCM alert
 * push, iOS VoIP push) each register a lifecycle here; the login/logout flows
 * invoke all registered lifecycles.
 */

export type PushRegistrationLifecycle = {
  /** (Re-)register this device's push token under the current session's user. */
  syncRegistration: () => Promise<void>;
  /** Unregister this device's push token for the currently logged-in user. */
  unregisterForLogout: () => Promise<void>;
};

const lifecycles = new Set<PushRegistrationLifecycle>();

/** Register a platform push lifecycle. Returns a function that removes it. */
export function registerPushRegistrationLifecycle(
  lifecycle: PushRegistrationLifecycle
): () => void {
  lifecycles.add(lifecycle);
  return () => lifecycles.delete(lifecycle);
}

const SYNC_RETRY_DELAY_MS = 5_000;

/**
 * (Re-)register this device's push tokens under the current session's user.
 * Call whenever a session is established — on login or at app launch with an
 * existing session.
 *
 * A failed sync leaves the previous account's registration in place on the
 * backend, so each lifecycle gets one short delayed retry against transient
 * failures (network blip, backend error).
 */
export async function syncPushRegistrations(): Promise<void> {
  await Promise.all(
    [...lifecycles].map(async (lifecycle) => {
      try {
        await lifecycle.syncRegistration();
      } catch (err) {
        console.error('push registration sync failed; retrying once', err);
        await new Promise((resolve) =>
          setTimeout(resolve, SYNC_RETRY_DELAY_MS)
        );
        try {
          await lifecycle.syncRegistration();
        } catch (retryErr) {
          console.error('push registration sync retry failed', retryErr);
        }
      }
    })
  );
}

/**
 * Best-effort unregister of this device's push registrations. Must run while
 * the session is still valid — the unregister call is authenticated.
 */
export async function unregisterPushRegistrationsForLogout(): Promise<void> {
  await Promise.all(
    [...lifecycles].map((lifecycle) =>
      lifecycle.unregisterForLogout().catch((err) => {
        console.error('failed to unregister push registration on logout', err);
      })
    )
  );
}
