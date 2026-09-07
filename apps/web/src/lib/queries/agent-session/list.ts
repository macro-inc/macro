/**
 * The caller's agent sessions as soup rows for the Agents view.
 *
 * Sessions live in `agent_harness_service`, not the storage soup, so the
 * view merges them client-side through `additionalEntities` — the same route
 * automations take. The list is a snapshot: a session's status here is what
 * it reported when fetched, and the block's live feed is the source of truth
 * once a row is opened.
 */

import { throwOnErr } from '@core/util/result';
import type { AgentSessionEntity } from '@entity';
import { queryClient } from '@queries/client';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import { subscribeAgentSessionRenamed } from './session-metadata-sync';

export const agentSessionListQueryKey = ['agentSession', 'list'] as const;

export function agentSessionToEntity(
  session: AgentSessionResponse
): AgentSessionEntity {
  return {
    id: session.id,
    type: 'agent_session',
    name: session.name,
    ownerId: session.ownerId,
    createdAt: session.createdAt,
    updatedAt: session.modifiedAt,
    botId: session.botId,
    harness: session.harness,
    model: session.model,
    status: session.status,
    threadId: session.threadId ?? undefined,
    externalUrl: session.external?.url ?? undefined,
  };
}

/** Re-read the list after a session is created or deleted. */
export function invalidateAgentSessionList() {
  void queryClient.invalidateQueries({ queryKey: agentSessionListQueryKey });
}

export function useAgentSessionListQuery(enabled: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: agentSessionListQueryKey,
    enabled: enabled(),
    queryFn: async () =>
      (await throwOnErr(() => agentHarnessServiceClient.list())).sessions,
    placeholderData: (prev: AgentSessionResponse[] | undefined) => prev,
    reconcile: 'id',
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: 'always' as const,
  }));
}

/**
 * Reactive list of agent-session entities for the Agents view. Returns `[]`
 * until the query resolves, and while `enabled` is false.
 *
 * Renames are patched into the cache from the same event the agent block
 * emits, so a row renamed in an open split updates without a refetch.
 */
export function useAgentSessionEntities(enabled: Accessor<boolean>) {
  const query = useAgentSessionListQuery(enabled);

  onCleanup(
    subscribeAgentSessionRenamed(({ agentSessionId, name }) => {
      queryClient.setQueryData(
        agentSessionListQueryKey,
        (current: AgentSessionResponse[] | undefined) =>
          current?.map((session) =>
            session.id === agentSessionId ? { ...session, name } : session
          )
      );
    })
  );

  return createMemo<AgentSessionEntity[]>(() => {
    if (!enabled()) return [];
    return (query.data ?? []).map(agentSessionToEntity);
  });
}
