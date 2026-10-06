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
// Incremented at logout to invalidate delayed retries from that session.
let sessionGeneration = 0;
// A registration pause set by logout, not an authoritative auth-state check.
let loggedOut = false;

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
 *
 * `source` identifies the caller's reason for syncing:
 * - `session` (the default): the caller has established an authenticated
 *   session. This lifts the registration pause set by logout; this function
 *   does not verify authentication itself.
 * - `resume`: app startup/resume or token refresh should reconcile the current
 *   registration, but must not lift a pause set by logout.
 *
 * Logout unregisters devices before clearing authentication because the
 * unregister request needs valid credentials. A native resume/token event in
 * that window must not register the account again just because its cookie
 * still exists. Only a subsequent `session` call may resume registration.
 *
 * A failed sync leaves the previous account's registration in place on the
 * backend, so each lifecycle gets one short delayed retry against transient
 * failures (network blip, backend error).
 */
export async function syncPushRegistrations(
  source: 'session' | 'resume' = 'session'
): Promise<void> {
  if (source === 'resume' && loggedOut) return;
  if (source === 'session') loggedOut = false;
  const generation = sessionGeneration;
  await Promise.all(
    [...lifecycles].map(async (lifecycle) => {
      try {
        await lifecycle.syncRegistration();
      } catch (err) {
        console.error('push registration sync failed; retrying once', err);
        await new Promise((resolve) =>
          setTimeout(resolve, SYNC_RETRY_DELAY_MS)
        );
        // A logout invalidates this retry even if another login has already
        // reset loggedOut to false. The boolean alone cannot detect that.
        if (generation !== sessionGeneration) return;
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
  loggedOut = true;
  ++sessionGeneration;
  await Promise.all(
    [...lifecycles].map((lifecycle) =>
      lifecycle.unregisterForLogout().catch((err) => {
        console.error('failed to unregister push registration on logout', err);
      })
    )
  );
}
