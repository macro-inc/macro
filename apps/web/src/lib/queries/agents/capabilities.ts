import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { DiscoverAgentCapabilitiesRequest } from '@service-agent-harness/generated/schemas';
import { useQuery } from '@tanstack/solid-query';

/** Capabilities belong to a harness and selected model, never a provider alone. */
export function useAgentCapabilitiesQuery(
  target: () => DiscoverAgentCapabilitiesRequest | undefined
) {
  return useQuery(() => ({
    queryKey: ['agent-capabilities', target() ?? null] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const request = target();
      if (!request) throw new Error('No capability target');
      const response = await throwOnErr(() =>
        agentHarnessServiceClient.discoverAgentCapabilities(request, signal)
      );
      return {
        configOptions: response.configOptions.map((option) => {
          const common = {
            id: option.id,
            name: option.name,
            description: option.description ?? null,
            category: option.category ?? null,
          };
          if (option.type === 'select')
            return {
              ...common,
              type: option.type,
              currentValue: option.currentValue,
              options: option.options.map((value) => ({
                ...value,
                description: value.description ?? null,
                group: value.group ?? null,
              })),
            };
          return {
            ...common,
            type: option.type,
            currentValue: option.currentValue,
          };
        }),
      };
    },
    enabled: target() !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  }));
}
