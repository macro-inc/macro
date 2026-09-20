import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentSessionKeys = createQueryKeys('agentSessionMentions', {
  detail: (id: string) => ({ queryKey: [id] }),
  preview: (id: string, graphql: boolean) => ({ queryKey: [id, graphql] }),
});

/**
 * A session's captured changes: the summary (invalidated by the
 * `agent_session_changes` realtime event) and the patch behind one capture,
 * keyed by changeset id so a newer capture never reads an older body.
 */
export const agentSessionChangesKeys = createQueryKeys('agentSessionChanges', {
  summary: (sessionId: string) => ({ queryKey: [sessionId] }),
  patch: (sessionId: string, changesetId: string) => ({
    queryKey: [sessionId, changesetId],
  }),
});
