import { ENABLE_GIT_BLAME } from '@core/constant/featureFlags';
import { syncServiceClient } from '@service-sync/client';
import { createQuery } from '@tanstack/solid-query';

export function useNodeBlameQuery(
  documentId: string,
  nodeId: () => string | null
) {
  return createQuery(() => ({
    queryKey: ['blame', documentId, nodeId()],
    queryFn: async () => {
      const res = await syncServiceClient.getNodeBlame({
        documentId,
        nodeId: nodeId()!,
      });
      return res.isOk() ? res.value : null;
    },
    enabled: ENABLE_GIT_BLAME() && nodeId() !== null,
    staleTime: Infinity,
  }));
}
