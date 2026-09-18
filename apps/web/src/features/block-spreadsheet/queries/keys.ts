import { createQueryKeys } from '@lukemorales/query-key-factory';

export const uploadedWorkbookKeys = createQueryKeys('uploadedWorkbook', {
  file: (id: string, version: number, fileType: string) => ({
    queryKey: [id, version, fileType],
  }),
});

export const spreadsheetCommentKeys = createQueryKeys('spreadsheetComments', {
  document: (id: string) => [id],
});
