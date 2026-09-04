/**
 * Bounded snapshot poll for an external session whose `external.url` is still
 * missing.
 *
 * An external provider may mint that url after session creation, and nothing
 * announces it on the wire, so a block opened mid-run can load a snapshot
 * without the provider link. This query re-reads
 * the same GET the feed already used, on a short budget (~30s) that covers
 * a slow mint. A URL-less row past the budget is a failed harness
 * follow-up, which no amount of polling can repair.
 */

import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

/**
 * How often, and how many times, to re-read an external session's snapshot
 * while its provider url is still missing.
 */
export const EXTERNAL_URL_POLL_INTERVAL_MS = 2_000;
export const EXTERNAL_URL_POLL_ATTEMPTS = 15;

/** Whether persisted session metadata says an external URL may arrive. */
export function sessionMayProvideExternalUrl(
  session: AgentSessionResponse
): boolean {
  return Boolean(session.external?.provider) || session.harness === 'cursor';
}

/**
 * Re-read an agent session snapshot while `sessionId` is set. Callers pass
 * `undefined` when the session has no external capability, already has a url, or
 * has not loaded yet — the query disables rather than fetching.
 *
 * `gcTime: 0` drops the observer when the call site unmounts so reopening
 * the block gets a fresh budget. `retry: false` keeps one GET per attempt,
 * matching that budget. The default 5-minute `staleTime` would not stop
 * `refetchInterval`, but it would hide a remount fetch; zero keeps each
 * observer honest.
 */
export function useAgentSessionExternalUrlQuery(
  sessionId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const id = sessionId();
    return {
      queryKey: ['agentSession', 'externalUrl', id ?? ''] as const,
      queryFn: async () =>
        await throwOnErr(() => agentHarnessServiceClient.get(id!)),
      enabled: Boolean(id),
      // Stop once the url lands or the attempt budget is spent. Failed
      // fetches count too, so a streak of errors cannot poll forever.
      refetchInterval: (query) => {
        if (query.state.data?.external?.url) return false;
        const attempts =
          query.state.dataUpdateCount + query.state.errorUpdateCount;
        if (attempts >= EXTERNAL_URL_POLL_ATTEMPTS) return false;
        return EXTERNAL_URL_POLL_INTERVAL_MS;
      },
      retry: false,
      staleTime: 0,
      gcTime: 0,
    };
  });
}
