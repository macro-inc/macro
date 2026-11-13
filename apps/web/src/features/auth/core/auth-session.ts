import { deriveIsAuthenticated } from '@core/context/user';
import type { UserInfoData } from '@queries/auth/user-info';
import type { AuthSession } from '../context/auth-context';

type UserInfoState = Parameters<typeof deriveIsAuthenticated>[0];

/**
 * The sign-in and sign-up screens' session, from the user info query.
 *
 * Elsewhere an unexplained failure (a 5xx, a network blip) leaves auth
 * unknown so a signed-in user is not bounced to login. These screens wait
 * on that state, though, so a failure that never resolves (an account whose
 * user record is missing answers 500 every time) would leave them blank for
 * good. Once the query has given up without data, show the signed-out
 * screens: signing in again is the way out.
 */
export function authSession(query: UserInfoState): AuthSession {
  const authenticated = deriveIsAuthenticated(query);
  if (authenticated === false) return { t: 'signed-out' };
  const data: UserInfoData | undefined = query.data;
  if (data?.userId) {
    return {
      t: 'signed-in',
      user: {
        id: data.userId,
        email: data.email ?? undefined,
        tutorialComplete: data.tutorialComplete === true,
        isAgent: data.isAgent === true,
      },
    };
  }
  if (query.isError) return { t: 'signed-out' };
  return { t: 'loading' };
}
