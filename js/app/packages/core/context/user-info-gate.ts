import { createSignal } from 'solid-js';
import { hasLoginCookie } from '@core/util/cookies';

// Signal to track if we should enable the user info query.
// Initially based on login cookie, can be enabled after authentication.
//
// Extracted into its own module to break the circular dependency between
// `@core/context/user` and `@queries/auth/user-info`. Both need access to
// this signal without importing each other.
const [shouldQueryUserInfo, setShouldQueryUserInfo] = createSignal(
  hasLoginCookie()
);

export { shouldQueryUserInfo };

/**
 * Enable the user info query. Call this after authentication completes
 * to trigger fetching user info.
 */
export function enableUserInfoQuery() {
  setShouldQueryUserInfo(true);
}
