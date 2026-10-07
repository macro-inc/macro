import type { ShareItemType } from '@core/component/TopBar/linkShare';
import { createQueryKeys } from '@lukemorales/query-key-factory';

export const sharingKeys = createQueryKeys('sharing', {
  permissions: (itemType: ShareItemType, id: string) => ({
    queryKey: [itemType, id],
  }),
});
