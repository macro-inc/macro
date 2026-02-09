import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { SoupItemsQueryArgs } from './items';
import type { SearchSoupQueryArgs } from './search';

export const soupKeys = createQueryKeys('soup', {
  items: (args: SoupItemsQueryArgs) => ({
    queryKey: [args.params, args.body],
  }),
  search: (args: SearchSoupQueryArgs) => ({
    queryKey: [args.params, args.body],
  }),
});
