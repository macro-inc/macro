import { analytics } from '@app/lib/analytics';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import { throwOnErr } from '@core/util/result';
import type { AgentSessionEntity } from '@entity';
import { queryClient } from '@queries/client';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { agentSessionKeys } from './keys';

/** Human-readable list-row name for a session: the repo it works on when one
 * was stated, otherwise a generic label. Sessions have no name of their own. */
function sessionName(session: AgentSessionResponse): string {
  const repoTail = session.repoUrl
    ?.replace(/\.git$/, '')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join('/');
  return repoTail || 'Agent session';
}

function agentSessionToEntity(
  session: AgentSessionResponse
): AgentSessionEntity {
  return {
    id: session.id,
    type: 'agent',
    name: sessionName(session),
    ownerId: session.ownerId,
    createdAt: session.createdAt,
    updatedAt: session.modifiedAt,
    botId: session.botId,
    model: session.model,
    repoUrl: session.repoUrl,
    status: session.status.kind,
  };
}

function useAgentSessionsQuery() {
  return useQuery(() => ({
    queryKey: agentSessionKeys.list.queryKey,
    queryFn: async () =>
      throwOnErr(async () => await agentHarnessServiceClient.list()),
    placeholderData: (prev) => prev,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: 'always' as const,
  }));
}

/** Drop the cached session list so the next Agents render refetches it.
 * Called after creating or deleting a session. */
function invalidateAgentSessions() {
  void queryClient.invalidateQueries({
    queryKey: agentSessionKeys.list.queryKey,
  });
}

/** Create a new Macro Coder agent session. The harness provisions the
 * sandbox; the session waits for its first prompt through the agent block. */
export async function createAgentSession(opts?: {
  /** UI surface the creation originated from, for analytics. */
  source?: string;
}) {
  const result = await agentHarnessServiceClient.create({
    botId: MACRO_CODER_BOT_ID,
  });
  if (result.isErr()) {
    return { error: 'Failed to create agent session.' };
  }
  const session = result.value.session;
  invalidateAgentSessions();

  analytics.track('create_entity', {
    entityType: 'agent',
    entityId: session.id,
    source: opts?.source,
  });

  return { sessionId: session.id };
}

/**
 * Reactive list of agent-session entities derived from the harness list
 * query. Safe to call from any component tree that's under a QueryClient —
 * returns `[]` until the query resolves.
 */
export function useAgentSessionEntities() {
  const sessionsQuery = useAgentSessionsQuery();
  return createMemo<AgentSessionEntity[]>(() => {
    const data = sessionsQuery.data;
    if (!data) return [];
    return data.sessions.map(agentSessionToEntity);
  });
}
