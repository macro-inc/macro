import { createQueryKeys } from '@lukemorales/query-key-factory';

export const documentProgramKeys = createQueryKeys('documentPrograms', {
  build: (documentId: string, savedVersion: number) => ({
    queryKey: [documentId, savedVersion],
  }),
});
