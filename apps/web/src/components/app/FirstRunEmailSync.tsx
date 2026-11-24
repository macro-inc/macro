import { initAndStartEmailSync } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { createEffect } from 'solid-js';

/**
 * First-time users (tutorial not yet completed) can reach the app without
 * passing through a login route that inits the email link (marketing SSO
 * returns to /app, not /login), so this kicks off email sync once. Idempotent
 * on the backend; AlreadyInitialized is ignored. Keyed by user id, not a bare
 * flag, so a native mobile logout→login of a different user in the same
 * session still inits.
 */
export function FirstRunEmailSync() {
  const userInfoQuery = useUserInfoQuery();
  let emailInitForUserId: string | undefined;
  createEffect(() => {
    const data = userInfoQuery.data;
    if (data?.authenticated !== true || data.tutorialComplete !== false) return;
    if (data.isAgent) return;
    if (emailInitForUserId === data.id) return;
    emailInitForUserId = data.id;

    fireAndForget(
      initAndStartEmailSync().match(
        () => {},
        (err) => {
          if (err.tag !== 'AlreadyInitialized') {
            console.error('Failed to init email link for new user', err);
          }
        }
      ),
      'email-sync'
    );
  });
  return null;
}
