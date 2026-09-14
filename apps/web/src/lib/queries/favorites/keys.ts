import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ListFavoritesParams } from '@service-storage/generated/schemas/listFavoritesParams';

export const favoriteKeys = createQueryKeys('favorites', {
  list: (filter?: ListFavoritesParams) => ({
    queryKey: [filter],
  }),
});
