import { createQueryKeys } from '@lukemorales/query-key-factory';

export const unknownFileKeys = createQueryKeys('unknownFile', {
  textPreview: (id: string | undefined, version: number | undefined) => ({
    queryKey: [id, version],
  }),
});
