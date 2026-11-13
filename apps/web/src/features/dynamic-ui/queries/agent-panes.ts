import {
  clause,
  compileClause,
  confine,
  type TargetExpr,
} from '@app/features/soup/filters';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import type { SoupAstItemsQueryArgs } from '@queries/soup/items';
import type { AgentSpendResponse } from '@service-cognition/generated/schemas/agentSpendResponse';
import type { AgentRoutine } from '@service-scheduled-action/generated/schemas/agentRoutine';
import type { AgentRoutines } from '@service-scheduled-action/generated/schemas/agentRoutines';
import { queryOptions } from '@tanstack/solid-query';
import type { SpendBucket } from '../generated/types';
import { agentPaneKeys } from './keys';

/** The agent's spend, one entry per period that had any, oldest first. */
export type AgentSpend = AgentSpendResponse;

export type AgentRoutineSummary = AgentRoutine;
export type AgentRoutineList = AgentRoutines;

/** Panes refresh on focus and every few minutes; spend moves slowly. */
const PANE_STALE_MS = 60_000;

export function agentSpendQueryOptions(agentId: string, bucket: SpendBucket) {
  return queryOptions({
    queryKey: agentPaneKeys.spend(agentId, bucket).queryKey,
    queryFn: ({ signal }) =>
      throwOnErr(() =>
        fetchWithToken<AgentSpend>(
          `${SERVER_HOSTS['cognition-service']}/ai-cost/agents/${encodeURIComponent(agentId)}/spend?bucket=${bucket}`,
          { method: 'GET', signal }
        )
      ),
    staleTime: PANE_STALE_MS,
    retry: false,
  });
}

export function agentRoutinesQueryOptions(agentId: string) {
  return queryOptions({
    queryKey: agentPaneKeys.routines(agentId).queryKey,
    queryFn: ({ signal }) =>
      throwOnErr(() =>
        fetchWithToken<AgentRoutineList>(
          `${SERVER_HOSTS['scheduled-action']}/scheduled-actions/agents/${encodeURIComponent(agentId)}`,
          { method: 'GET', signal }
        )
      ),
    staleTime: PANE_STALE_MS,
    retry: false,
  });
}

/**
 * The agent sessions an agent account owns that the viewer can see, newest
 * first. Unlisted routine runs are left out, as the Agents list does.
 */
export function agentSessionsQuery(agentId: string): SoupAstItemsQueryArgs {
  const sessions: TargetExpr[] = [
    clause.eq('includeAgentSessions', true),
    clause.eq('agentSessionOwnerId', agentId),
    clause.not(clause.eq('agentSessionVisibility', 'unlisted')),
  ];
  return {
    params: { expand: true, sort_method: 'updated_at', limit: 100 },
    body: compileClause(confine({ asf: clause.and(...sessions) })),
  };
}
