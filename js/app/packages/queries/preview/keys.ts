import { createQueryKeys } from '@lukemorales/query-key-factory';

export const previewKeys = createQueryKeys('preview', {
  item: (itemId: string) => ({
    queryKey: [itemId],
  }),
});
