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
  harnesses: readonly Pick<Harness, 'id'>[],
  claudeCloudEnabled: boolean
): AgentModelTarget[] {
  const targets: AgentModelTarget[] = [{ harness: 'in-memory' }];
  if (claudeCloudEnabled) targets.push({ harness: 'claude-cloud' });
  if (cursorRegistered) targets.push({ harness: 'cursor' });
  targets.push(
    ...harnesses.map(
      (harness): AgentModelTarget => ({
        harness: 'macrod',
        harnessId: harness.id,
      })
    )
  );
  return targets;
}

/** In-memory models are compiled into the harness and do not change at runtime. */
const IN_MEMORY_MODELS_STALE_TIME = Number.POSITIVE_INFINITY;

/**
 * Cursor and macrod catalogs can change, but not between two mounts of the
 * composer. Refetching on every mount put `agent-models/load` on the same
 * service as the prompt.
 */
const REMOTE_MODELS_STALE_TIME = 5 * 60 * 1000;

const MODELS_GC_TIME = 30 * 60 * 1000;

export function agentModelsQueryOptions(target: AgentModelTarget) {
  const staleTime =
    target.harness === 'in-memory'
      ? IN_MEMORY_MODELS_STALE_TIME
      : REMOTE_MODELS_STALE_TIME;
  return {
    queryKey: [
      'agent-models',
      'load',
      target.harness,
      target.harnessId ?? null,
    ] as const,
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<LoadAgentModelsResponse> =>
      await throwOnErr(() =>
        agentHarnessServiceClient.loadAgentModels(target, signal)
      ),
    gcTime: MODELS_GC_TIME,
    staleTime,
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
