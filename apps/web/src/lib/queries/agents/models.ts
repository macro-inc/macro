import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  LoadAgentModelsRequest,
  LoadAgentModelsResponse,
} from '@service-agent-harness/generated/schemas';
import type { Harness } from '@service-storage/client';
import { useQueries, useQuery } from '@tanstack/solid-query';

export type AgentModelTarget = LoadAgentModelsRequest;

/** Every model provider available to the agent dialog, in display order. */
export function buildAgentModelTargets(
  cursorRegistered: boolean,
  harnesses: readonly Pick<Harness, 'id'>[]
): AgentModelTarget[] {
  return [
    { harness: 'in-memory' },
    ...(cursorRegistered ? [{ harness: 'cursor' }] : []),
    ...harnesses.map((harness) => ({
      harness: 'macrod',
      harnessId: harness.id,
    })),
  ];
}

export function agentModelsQueryOptions(target: AgentModelTarget) {
  return {
    queryKey: [
      'agent-models',
      'load',
      target.harness,
      target.harnessId ?? null,
    ] as const,
    queryFn: async (): Promise<LoadAgentModelsResponse> =>
      await throwOnErr(() => agentHarnessServiceClient.loadAgentModels(target)),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  };
}

/** Launches one independent, fresh model-discovery request per target. */
export function useAgentModelsQueries(
  targets: () => readonly AgentModelTarget[]
) {
  return useQueries(() => ({
    queries: targets().map(agentModelsQueryOptions),
  }));
}

/** Loads one provider's current model catalog. */
export function useAgentModelsQuery(
  target: () => AgentModelTarget,
  enabled: () => boolean = () => true
) {
  return useQuery(() => ({
    ...agentModelsQueryOptions(target()),
    enabled: enabled(),
  }));
}
