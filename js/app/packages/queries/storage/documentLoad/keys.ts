import { createQueryKeys } from '@lukemorales/query-key-factory';

export const documentLoadKeys = createQueryKeys('documentLoad', {
  bundle: (documentId: string) => ({
    queryKey: [documentId],
  }),
});
