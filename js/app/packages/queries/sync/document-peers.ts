import { syncServiceClient } from '@service-sync/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { syncKeys } from './keys';

async function fetchDocumentPeers(
  documentId: string
): Promise<Map<string, string>> {
  const result = await syncServiceClient.getDocumentMetadata({ documentId });
  if (result.isErr()) throw new Error(String(result.error));
  return new Map(result.value.peers.map((p) => [String(p.peer_id), p.user_id]));
}

export function useDocumentPeersQuery(documentId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: syncKeys.documentPeers(documentId()).queryKey,
    queryFn: () => fetchDocumentPeers(documentId()),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!documentId(),
  }));
}
