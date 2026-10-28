import { createQueryKeys } from '@lukemorales/query-key-factory';

export const docxKeys = createQueryKeys('docx', {
  original: (documentId: string) => ({ queryKey: [documentId] }),
});
