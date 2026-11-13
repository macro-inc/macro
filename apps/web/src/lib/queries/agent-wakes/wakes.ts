import {
  type HeardTrace,
  heardTrace,
  traceRefreshMs,
  wakesRefreshMs,
} from '@app/features/dynamic-ui/widgets/wakes/format';
import {
  type AgentWakesFilter,
  getAgentWake,
  getAgentWakeTrace,
  listAgentWakes,
} from '@service-agent-harness/agent-wakes';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentWakeKeys } from './keys';

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
      query.state.data
        ? wakesRefreshMs(query.state.data.wakes, Date.now())
        : false,
  });
}

function agentWakeTraceQueryOptions(agentId: string, wakeId: string) {
  return queryOptions({
    queryKey: agentWakeKeys.trace(agentId, wakeId).queryKey,
    queryFn: async ({ signal }): Promise<HeardTrace | null> => {
      // The wake's row says when it was last heard from, which a live trace's
      // own timestamps don't while a step runs long, and whether it ended.
      const [result, wake] = await Promise.all([
        getAgentWakeTrace(agentId, wakeId, signal),
        getAgentWake(agentId, wakeId, signal),
      ]);
      if (result.isErr()) {
        if (result.error[0]?.code === 'NOT_FOUND') return null;
        throw new Error(result.error[0]?.message ?? 'Failed to load trace');
      }
      return heardTrace(result.value, wake.isOk() ? wake.value : null);
    },
    refetchInterval: (query) =>
      query.state.data ? traceRefreshMs(query.state.data, Date.now()) : false,
  });
}

/**
 * The newest page of an agent account's wakes, or `null` when the viewer may
 * not read them. Refreshes while any listed wake is still running, so
 * liveness follows the wakes' `end` records; a wake that stopped reporting
 * (`wakeState` `lost`) keeps only a slow refresh, in case its end still comes.
 */
export function useAgentWakesQuery(
  agentId: Accessor<string>,
  filter: Accessor<AgentWakesFilter>
) {
  return useQuery(() => agentWakesQueryOptions(agentId(), filter()));
}

/**
 * One wake's trace with what its row says (last heard, ended), or `null` when the
 * viewer may not read it, none was uploaded, or it expired.
 */
export function useAgentWakeTraceQuery(
  agentId: Accessor<string>,
  wakeId: Accessor<string>
) {
  return useQuery(() => agentWakeTraceQueryOptions(agentId(), wakeId()));
}
