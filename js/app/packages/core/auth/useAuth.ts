import { invalidateUserInfo } from '@queries/auth/user-info';
import { useIsAuthenticated } from '@core/context/user';

// Re-export useIsAuthenticated from context for backwards compatibility
export { useIsAuthenticated };

/** @deprecated Use invalidateUserInfo() from @queries/auth/user-info instead */
export async function updateUserAuth() {
  return invalidateUserInfo();
}
