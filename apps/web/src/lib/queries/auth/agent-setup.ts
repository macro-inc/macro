import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { authServiceClient } from '@service-auth/client';
import { useMutation } from '@tanstack/solid-query';

/** Mints an agent's SDK token, replacing any earlier one. */
export function useAgentSetupMutation() {
  return useMutation(() => ({
    mutationFn: () =>
      Telemetry.span('agent.setup', () =>
        throwOnErr(async () => await authServiceClient.agentSetup())
      ),
    retry: 2,
  }));
}
