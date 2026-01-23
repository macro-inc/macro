import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ItemType } from '@service-storage/client';

export const previewKeys = createQueryKeys('preview', {
  item: (itemId: string, itemType?: ItemType) => ({
    queryKey: [itemId, itemType],
  }),
});
