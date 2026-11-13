import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type {
  AgentWake,
  AgentWakeStatusFilter,
  AgentWakesPage,
  WakeTrace,
  WakeTraceSpan,
} from './generated/schemas';

export type { AgentWake, AgentWakeStatusFilter, WakeTrace, WakeTraceSpan };

const wakes = (agentId: string) =>
  `${SERVER_HOSTS['agent-harness']}/agents/${encodeURIComponent(agentId)}/wakes`;

/** Which of an agent account's wakes to list. */
export type AgentWakesFilter = {
  status?: AgentWakeStatusFilter;
  limit?: number;
};

/**
 * The newest page of an agent account's wakes. `NOT_FOUND` when the viewer
 * may not read them (only the agent and its teams' owners and admins may) or
 * agent dashboards are off for them.
 */
export function listAgentWakes(
  agentId: string,
  filter: AgentWakesFilter,
  signal?: AbortSignal
) {
  const query = new URLSearchParams();
  if (filter.status) query.set('status', filter.status);
  if (filter.limit !== undefined) query.set('limit', String(filter.limit));
  return fetchWithToken<AgentWakesPage>(`${wakes(agentId)}?${query}`, {
    method: 'GET',
    signal,
  });
}

/** One of an agent account's wakes. */
export function getAgentWake(
  agentId: string,
  wakeId: string,
  signal?: AbortSignal
) {
  return fetchWithToken<AgentWake>(
    `${wakes(agentId)}/${encodeURIComponent(wakeId)}`,
    { method: 'GET', signal }
  );
}

/** A wake's trace. `NOT_FOUND` also when none was uploaded or it expired. */
export function getAgentWakeTrace(
  agentId: string,
  wakeId: string,
  signal?: AbortSignal
) {
  return fetchWithToken<WakeTrace>(
    `${wakes(agentId)}/${encodeURIComponent(wakeId)}/trace`,
    { method: 'GET', signal }
  );
}
