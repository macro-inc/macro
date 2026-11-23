import { useUserId } from '@core/context/user';
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
  const targets: AgentModelTarget[] = [{ harness: 'in-memory' }];
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

/** The in-memory catalog depends on current plan permissions. */
const IN_MEMORY_MODELS_STALE_TIME = 60 * 1000;

/**
 * Cursor and macrod catalogs can change, but not between two mounts of the
 * composer. Refetching on every mount put `agent-models/load` on the same
 * service as the prompt.
 */
const REMOTE_MODELS_STALE_TIME = 5 * 60 * 1000;

const MODELS_GC_TIME = 30 * 60 * 1000;

export function agentModelsQueryOptions(
  target: AgentModelTarget,
  userId: string | undefined
) {
  const staleTime =
    target.harness === 'in-memory'
      ? IN_MEMORY_MODELS_STALE_TIME
      : REMOTE_MODELS_STALE_TIME;
  return {
    queryKey: [
      'agent-models',
      'load',
      userId ?? null,
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
  const userId = useUserId();
  return useQueries(() => ({
    queries: targets().map((target) => ({
      ...agentModelsQueryOptions(target, userId()),
      enabled: Boolean(userId()),
    })),
  }));
}

/** Loads one provider's current model catalog. */
export function useAgentModelsQuery(
  target: () => AgentModelTarget,
  enabled: () => boolean = () => true
) {
  const userId = useUserId();
  return useQuery(() => ({
    ...agentModelsQueryOptions(target(), userId()),
    enabled: Boolean(userId()) && enabled(),
  }));
}
