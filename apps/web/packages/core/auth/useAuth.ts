import { useIsAuthenticated } from '@core/context/user';
import { invalidateUserInfo } from '@queries/auth/user-info';

// Re-export useIsAuthenticated from context for backwards compatibility
export { useIsAuthenticated };

/** @deprecated Use invalidateUserInfo() from @queries/auth/user-info instead */
export async function updateUserAuth() {
  return invalidateUserInfo();
}
