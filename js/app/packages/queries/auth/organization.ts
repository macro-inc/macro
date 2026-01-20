import { throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { useQuery } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { queryClient } from '../client';
import { authKeys } from './keys';

const ORGANIZATION_STALE_TIME = 15_000; // 15 seconds, consistent with user info

function organizationQueryOptions() {
  return {
    queryKey: authKeys.organization.queryKey,
    queryFn: async () => throwOnErr(authServiceClient.getOrganization),
    staleTime: ORGANIZATION_STALE_TIME,
    initialData: {
      organizationId: undefined,
      organizationName: undefined,
    },
  };
}

/** Query for the current user's organization. */
export function useOrganizationQuery() {
  return useQuery(() => organizationQueryOptions());
}

/** Invalidate the organization query to trigger a refetch. */
export function invalidateOrganization() {
  return queryClient.invalidateQueries({
    queryKey: authKeys.organization.queryKey,
  });
}

/** Returns whether the current user is in an organization. */
export function useIsInOrganization() {
  const query = useOrganizationQuery();
  return createMemo(() => !!query.data?.organizationId);
}

/** Returns the current user's organization ID. */
export function useOrganizationId() {
  const query = useOrganizationQuery();
  return createMemo(() => query.data?.organizationId);
}

/** Returns the current user's organization name. */
export function useOrganizationName() {
  const query = useOrganizationQuery();
  return createMemo(() => query.data?.organizationName);
}
