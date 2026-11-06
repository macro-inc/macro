import { throwOnErr } from '@core/util/result';
import { invalidateAgents } from '@queries/agents/agents';
import { queryClient } from '@queries/client';
import { invalidateHarnesses } from '@queries/harnesses/harnesses';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentSessionRuntimeBypassKeys } from './keys';

// Never cached as fresh: the runtime and the agent can change in Settings at
// any time.
function runtimeBypassOfferQueryOptions(sessionId: string, enabled: boolean) {
  return queryOptions({
    queryKey: agentSessionRuntimeBypassKeys.offer(sessionId).queryKey,
    queryFn: async () =>
      (
        await throwOnErr(() =>
          agentHarnessServiceClient.runtimeBypassOffer(sessionId)
        )
      ).offer ?? null,
    enabled: enabled && sessionId !== '',
    staleTime: 0,
    retry: false,
  });
}

/**
 * What stopping the session's permission requests on its runtime would
 * change for the viewer, read only while `enabled`: a request is waiting and
 * the viewer may answer it.
 */
export function useRuntimeBypassOfferQuery(
  sessionId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return useQuery(() =>
    runtimeBypassOfferQueryOptions(sessionId() ?? '', enabled())
  );
}

/**
 * Turn on the session's runtime bypass, and its agent's when that asks too.
 * Settings and every offer read again afterwards, whether or not it worked.
 */
export async function stopAskingOnRuntime(sessionId: string) {
  const result = await agentHarnessServiceClient.stopAskingOnRuntime(sessionId);
  await Promise.all([
    invalidateHarnesses(),
    invalidateAgents(),
    queryClient.invalidateQueries({
      queryKey: agentSessionRuntimeBypassKeys.offer._def,
    }),
  ]);
  return result;
}
