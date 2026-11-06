import { throwOnErr } from '@core/util/result';
import { invalidateAgents } from '@queries/agents/agents';
import { queryClient } from '@queries/client';
import { invalidateHarnesses } from '@queries/harnesses/harnesses';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentSessionRuntimeBypassKeys } from './keys';

/**
 * What stopping the session's permission requests on its runtime would
 * change for the viewer, read only while `enabled`: a request is waiting and
 * the viewer may answer it. Never cached as fresh, since the runtime and the
 * agent can change in Settings at any time.
 */
export function useRuntimeBypassOfferQuery(
  sessionId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    queryKey: agentSessionRuntimeBypassKeys.offer(sessionId() ?? '').queryKey,
    queryFn: async () =>
      (
        await throwOnErr(() =>
          agentHarnessServiceClient.runtimeBypassOffer(sessionId() ?? '')
        )
      ).offer ?? null,
    enabled: enabled() && sessionId() !== undefined,
    staleTime: 0,
    retry: false,
  }));
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
