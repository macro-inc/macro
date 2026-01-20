import { createMemo } from 'solid-js';
import { invalidateUserInfo } from '@queries/auth/user-info';
import { useIsAuthenticated } from '@core/context/user';

// Re-export useIsAuthenticated from context for backwards compatibility
export { useIsAuthenticated };

export function useIsOrganizationMember() {
  // Import dynamically to avoid circular dependency
  const { useOrganizationId } = require('@core/user');
  const organizationId = useOrganizationId();
  return createMemo((): boolean => {
    return organizationId() !== undefined;
  });
}

/** @deprecated Use invalidateUserInfo() from @queries/auth/user-info instead */
export async function updateUserAuth() {
  return invalidateUserInfo();
}
