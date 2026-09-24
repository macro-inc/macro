import { createQueryKeys } from '@lukemorales/query-key-factory';

export const documentLoadKeys = createQueryKeys('documentLoad', {
  bundle: (documentId: string) => ({
    queryKey: [documentId],
  }),
  offlineContext: (userId: string, epoch: string, documentId: string) => ({
    queryKey: [userId, epoch, documentId],
  }),
  authorizedBundle: (userId: string, epoch: string, documentId: string) => ({
    queryKey: [userId, epoch, documentId],
  }),
});
