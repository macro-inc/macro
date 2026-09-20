/**
 * Queries and mutations for an agent session's captured changes.
 *
 * The summary (changed files, counts, latest capture attempt) is small and
 * refetched whenever the `agent_session_changes` realtime event names the
 * session. The patch is fetched once per changeset id and cached for the
 * life of the page: a newer capture has a new id, so an old body is never
 * shown for a new summary.
 */

import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { invalidateAgentSessionChanges } from './changes-sync';
import { agentSessionChangesKeys } from './keys';

/**
 * While a capture is in flight the realtime event may race the HTTP answer
 * or be missed on a flaky socket, so the summary re-reads on a short
 * interval until the attempt settles.
 */
export const CAPTURE_POLL_INTERVAL_MS = 3_000;

/** The session's latest changes summary. Disabled while `sessionId` is unset. */
export function useAgentSessionChangesQuery(
  sessionId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const id = sessionId();
    return {
      queryKey: agentSessionChangesKeys.summary(id ?? '').queryKey,
      queryFn: () =>
        throwOnErr(() => agentHarnessServiceClient.getChanges(id!)),
      enabled: Boolean(id),
      retry: false,
      staleTime: 30_000,
      refetchInterval: (query) =>
        query.state.data?.capturing ? CAPTURE_POLL_INTERVAL_MS : false,
    };
  });
}

/**
 * The unified diff behind one changeset. Callers pass the changeset id from
 * the summary; `undefined` disables the query rather than fetching a body
 * that has not been captured yet.
 */
export function useAgentSessionChangesPatchQuery(
  sessionId: Accessor<string | undefined>,
  changesetId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const id = sessionId();
    const changeset = changesetId();
    return {
      queryKey: agentSessionChangesKeys.patch(id ?? '', changeset ?? '')
        .queryKey,
      queryFn: () =>
        throwOnErr(() => agentHarnessServiceClient.getChangesPatch(id!)),
      enabled: Boolean(id) && Boolean(changeset),
      retry: 1,
      // A changeset's body never changes once captured.
      staleTime: Number.POSITIVE_INFINITY,
    };
  });
}

/**
 * Ask the server to capture the session's changes again. The answer is the
 * state as it stood when the capture started; the summary is invalidated so
 * the pane shows "capturing" at once, and the realtime event lands the
 * result.
 */
export function useRefreshAgentSessionChangesMutation() {
  return useMutation(() => ({
    retry: false,
    mutationFn: (sessionId: string) =>
      throwOnErr(() => agentHarnessServiceClient.refreshChanges(sessionId)),
    onSettled: (_data, _error, sessionId) =>
      invalidateAgentSessionChanges(sessionId),
  }));
}
