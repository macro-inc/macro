import { createQueryKeys } from '@lukemorales/query-key-factory';

export const syncKeys = createQueryKeys('sync', {
  documentPeers: (documentId: string) => ({ queryKey: [documentId] }),
});
