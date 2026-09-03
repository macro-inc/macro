import { enableGitBlame, isFeatureEnabled } from '@core/constant/featureFlags';
import { syncServiceClient } from '@service-sync/client';
import { useQuery } from '@tanstack/solid-query';

export function useNodeBlameQuery(
  documentId: string,
  nodeId: () => string | null
) {
  return useQuery(() => ({
    queryKey: ['blame', documentId, nodeId()],
    queryFn: async () => {
      const res = await syncServiceClient.getNodeBlame({
        documentId,
        nodeId: nodeId()!,
      });
      if (!res.isOk()) throw new Error('blame_not_found');
      return res.value;
    },
    enabled: isFeatureEnabled(enableGitBlame) && nodeId() !== null,
    staleTime: Infinity,
    retry: false,
  }));
}
