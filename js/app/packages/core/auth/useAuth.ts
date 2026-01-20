import { createMemo } from 'solid-js';
import {
  invalidateUserInfo,
  useIsAuthenticated,
} from '@queries/auth/user-info';

// Re-export useIsAuthenticated from queries for backwards compatibility
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
