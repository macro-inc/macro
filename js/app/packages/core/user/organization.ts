import type { IUser } from '@core/user';
import { useOrganizationQuery } from '@queries/auth';
import { createMemo } from 'solid-js';

export function useOrganizationUsers() {
  return createMemo<IUser[]>(() => []);
}

export function useOrganizationName() {
  const organizationQuery = useOrganizationQuery();
  return createMemo((): string | undefined => {
    if (organizationQuery.isLoading) return undefined;
    if (!organizationQuery.data) return undefined;

    return organizationQuery.data.organizationName;
  });
}

export function useOrganizationId() {
  const organizationQuery = useOrganizationQuery();
  return createMemo((): string | undefined => {
    if (organizationQuery.isLoading) return undefined;
    if (!organizationQuery.data) return undefined;

    return organizationQuery.data.organizationId;
  });
}
