import {
  traceIsLive,
  wakeState,
} from '@app/features/dynamic-ui/widgets/wakes/format';
import {
  type AgentWakesFilter,
  getAgentWakeTrace,
  listAgentWakes,
} from '@service-agent-harness/agent-wakes';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentWakeKeys } from './keys';

/** While a wake runs, its row is re-read this often to show it ending. */
const LIVE_REFRESH_MS = 15_000;

function agentWakesQueryOptions(agentId: string, filter: AgentWakesFilter) {
  return queryOptions({
    queryKey: agentWakeKeys.list(agentId, filter).queryKey,
    queryFn: async ({ signal }) => {
      const result = await listAgentWakes(agentId, filter, signal);
      if (result.isErr()) {
        // Not found answers both "no access" and "no such agent".
        if (result.error[0]?.code === 'NOT_FOUND') return null;
        throw new Error(result.error[0]?.message ?? 'Failed to load wakes');
      }
      return result.value;
    },
    refetchInterval: (query) =>
      query.state.data?.wakes.some(
        (wake) => wakeState(wake, Date.now()) === 'running'
      )
        ? LIVE_REFRESH_MS
        : false,
  });
}

function agentWakeTraceQueryOptions(agentId: string, wakeId: string) {
  return queryOptions({
    queryKey: agentWakeKeys.trace(agentId, wakeId).queryKey,
    queryFn: async ({ signal }) => {
      const result = await getAgentWakeTrace(agentId, wakeId, signal);
      if (result.isErr()) {
        if (result.error[0]?.code === 'NOT_FOUND') return null;
        throw new Error(result.error[0]?.message ?? 'Failed to load trace');
      }
      return result.value;
    },
    refetchInterval: (query) =>
      query.state.data && traceIsLive(query.state.data, Date.now())
        ? LIVE_REFRESH_MS
        : false,
  });
}

/**
 * The newest page of an agent account's wakes, or `null` when the viewer may
 * not read them. Refreshes while any listed wake is still running, so
 * liveness follows the wakes' `end` records; a wake that stopped reporting
 * (`wakeState` `lost`) no longer keeps it refreshing.
 */
export function useAgentWakesQuery(
  agentId: Accessor<string>,
  filter: Accessor<AgentWakesFilter>
) {
  return useQuery(() => agentWakesQueryOptions(agentId(), filter()));
}

/**
 * One wake's trace, or `null` when the viewer may not read it, none was
 * uploaded, or it expired.
 */
export function useAgentWakeTraceQuery(
  agentId: Accessor<string>,
  wakeId: Accessor<string>
) {
  return useQuery(() => agentWakeTraceQueryOptions(agentId(), wakeId()));
}
