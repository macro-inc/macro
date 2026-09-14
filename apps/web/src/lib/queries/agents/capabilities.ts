import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentConfigOptionDto,
  DiscoverAgentCapabilitiesRequest,
  DiscoverAgentCapabilitiesResponse,
} from '@service-agent-harness/generated/schemas';
import type { Harness } from '@service-storage/client';
import { useQueries, useQuery } from '@tanstack/solid-query';

export type AgentCapabilityTarget = DiscoverAgentCapabilitiesRequest;

export type DiscoveredModel = {
  id: string;
  name: string;
  description?: string;
  group?: string;
};

/** Compatibility projection for settings surfaces that configure a persona's
 * default model rather than a live ACP session. */
export function discoveredModels(capabilities: {
  configOptions: AgentConfigOptionDto[];
}) {
  const option =
    capabilities.configOptions.find((option) => option.category === 'model') ??
    capabilities.configOptions.find((option) => option.id === 'model');
  if (option?.type !== 'select') {
    return {
      status: 'unsupported' as const,
      currentModel: undefined,
      models: [] as DiscoveredModel[],
    };
  }
  return {
    status: 'available' as const,
    currentModel: option.currentValue,
    models: option.options.map((model) => ({
      id: model.value,
      name: model.name,
      description: model.description ?? undefined,
      group: model.group ?? undefined,
    })),
  };
}

/** Every capability provider available to the agent dialog, in display order. */
export function buildAgentCapabilityTargets(
  cursorRegistered: boolean,
  harnesses: readonly Pick<Harness, 'id'>[]
): AgentCapabilityTarget[] {
  const targets: AgentCapabilityTarget[] = [{ harness: 'in-memory' }];
  if (cursorRegistered) targets.push({ harness: 'cursor' });
  targets.push(
    ...harnesses.map(
      (harness): AgentCapabilityTarget => ({
        harness: 'macrod',
        harnessId: harness.id,
      })
    )
  );
  return targets;
}

export function agentCapabilitiesQueryOptions(target: AgentCapabilityTarget) {
  return {
    queryKey: [
      'agent-capabilities',
      'discover',
      target.harness,
      target.harnessId ?? null,
    ] as const,
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<DiscoverAgentCapabilitiesResponse> =>
      await throwOnErr(() =>
        agentHarnessServiceClient.discoverAgentCapabilities(target, signal)
      ),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  };
}

/** Launches one independent, fresh capability-discovery request per target. */
export function useAgentCapabilitiesQueries(
  targets: () => readonly AgentCapabilityTarget[]
) {
  return useQueries(() => ({
    queries: targets().map(agentCapabilitiesQueryOptions),
  }));
}

/** Loads one provider's current session capabilities. */
export function useAgentCapabilitiesQuery(
  target: () => AgentCapabilityTarget,
  enabled: () => boolean = () => true
) {
  return useQuery(() => ({
    ...agentCapabilitiesQueryOptions(target()),
    enabled: enabled(),
  }));
}
