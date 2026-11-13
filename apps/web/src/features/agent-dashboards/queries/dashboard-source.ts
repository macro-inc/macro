import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { DashboardSource } from '../context/dashboard-source';
import type { Dashboard } from '../core/dashboard';
import {
  dashboardFailure,
  fetchDashboard,
  fetchHomeDashboard,
} from './dashboard-client';
import { agentDashboardKeys } from './keys';

/** A missing or forbidden dashboard won't appear on retry; anything else gets one more try. */
function retryDashboard(failureCount: number, error: unknown): boolean {
  return dashboardFailure(error) === 'failed' && failureCount < 1;
}

export function homeDashboardQueryOptions(viewerId: string, userId: string) {
  return queryOptions({
    queryKey: agentDashboardKeys.home(viewerId, userId).queryKey,
    queryFn: () => throwOnErr(() => fetchHomeDashboard(userId)),
    enabled: viewerId !== '' && userId !== '',
    retry: retryDashboard,
  });
}

export function dashboardQueryOptions(viewerId: string, dashboardId: string) {
  return queryOptions({
    queryKey: agentDashboardKeys.dashboard(viewerId, dashboardId).queryKey,
    queryFn: () => throwOnErr(() => fetchDashboard(dashboardId)),
    enabled: viewerId !== '' && dashboardId !== '',
    retry: retryDashboard,
  });
}

type DashboardQuery = {
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  data: Dashboard | undefined;
  error: unknown;
  refetch(): Promise<unknown>;
};

function toSource(query: DashboardQuery): DashboardSource {
  return {
    // Gate the read (pending `data` would suspend the caller) on pending
    // only, so a loaded dashboard survives a failed refresh.
    dashboard: () => (query.isPending ? undefined : query.data),
    isLoading: () => query.isLoading,
    // A retry in flight is a load again, not the old failure.
    failure: () =>
      query.isError && !query.isFetching
        ? dashboardFailure(query.error)
        : undefined,
    retry: () => fireAndForget(query.refetch(), 'agent-dashboards'),
  };
}

export function createHomeDashboardSource(
  viewerId: Accessor<string | undefined>,
  userId: Accessor<string>
): DashboardSource {
  return toSource(
    useQuery(() => homeDashboardQueryOptions(viewerId() ?? '', userId()))
  );
}

export function createDashboardSource(
  viewerId: Accessor<string | undefined>,
  dashboardId: Accessor<string>
): DashboardSource {
  return toSource(
    useQuery(() => dashboardQueryOptions(viewerId() ?? '', dashboardId()))
  );
}
