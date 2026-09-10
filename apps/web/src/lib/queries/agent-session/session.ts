/**
 * Bounded snapshot poll for a Cursor session whose `external.url` is still
 * missing.
 *
 * Cursor mints that url inside the session's first prompt, and nothing
 * announces it on the wire, so a block opened from the magic chip mid-run
 * loads a snapshot without the "Open in Cursor" link. This query re-reads
 * the same GET the feed already used, on a short budget (~30s) that covers
 * a slow mint. A url-less row past the budget is a failed harness
 * follow-up, which no amount of polling can repair.
 */

import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

/**
 * How often, and how many times, to re-read a Cursor session's snapshot
 * while its cursor.com url is still missing. Together they span ~30s, which
 * comfortably covers Cursor's agent creation inside the first prompt.
 */
export const EXTERNAL_URL_POLL_INTERVAL_MS = 2_000;
export const EXTERNAL_URL_POLL_ATTEMPTS = 15;

/**
 * Re-read an agent session snapshot while `sessionId` is set. Callers pass
 * `undefined` when the session is not a Cursor bot, already has a url, or
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
