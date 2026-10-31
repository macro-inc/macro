import type { PeerRecord } from '@block-md/history/author';
import { ThrownResultError } from '@core/util/result';
import { syncServiceClient } from '@service-sync/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { syncKeys } from './keys';

async function fetchDocumentPeers(
  documentId: string
): Promise<Map<string, PeerRecord>> {
  const result = await syncServiceClient.getDocumentMetadata({ documentId });
  if (result.isErr()) throw new ThrownResultError(result.error);
  return new Map(
    result.value.peers.map((p) => [
      String(p.peer_id),
      { userId: p.user_id, actor: p.actor ?? null },
    ])
  );
}

function documentPeersQueryOptions(documentId: string) {
  return queryOptions({
    queryKey: syncKeys.documentPeers(documentId).queryKey,
    queryFn: () => fetchDocumentPeers(documentId),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!documentId,
  });
}

export function useDocumentPeersQuery(documentId: Accessor<string>) {
  return useQuery(() => documentPeersQueryOptions(documentId()));
}
