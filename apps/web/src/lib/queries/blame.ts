import { enableGitBlame, isFeatureEnabled } from '@core/constant/featureFlags';
import { syncServiceClient } from '@service-sync/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';

async function fetchNodeBlame(documentId: string, nodeId: string) {
  const res = await syncServiceClient.getNodeBlame({ documentId, nodeId });
  if (!res.isOk()) throw new Error('blame_not_found');
  return res.value;
}

function nodeBlameQueryOptions(documentId: string, nodeId: string | null) {
  return queryOptions({
    queryKey: ['blame', documentId, nodeId],
    queryFn: () => fetchNodeBlame(documentId, nodeId!),
    enabled: isFeatureEnabled(enableGitBlame) && nodeId !== null,
    staleTime: Infinity,
    retry: false,
  });
}

export function useNodeBlameQuery(
  documentId: string,
  nodeId: () => string | null
) {
  return useQuery(() => nodeBlameQueryOptions(documentId, nodeId()));
}
