import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { GroupByField } from './grouped/types';
import type { SoupAstItemsQueryArgs, SoupItemsQueryArgs } from './items';
import type { SearchSoupQueryArgs } from './search';

export const soupKeys = createQueryKeys('soup', {
  items: (args: SoupItemsQueryArgs) => ({
    queryKey: [args.params, args.body],
  }),
  astItems: (args: SoupAstItemsQueryArgs) => ({
    queryKey: [args.params, args.body, args.groupBy, args.groupKey],
  }),
  search: (args: SearchSoupQueryArgs) => ({
    queryKey: [args.params, args.body],
  }),
  groupedGroup: (args: {
    params: SoupAstItemsQueryArgs['params'];
    body: SoupAstItemsQueryArgs['body'];
    groupBy: GroupByField;
    groupKey: string;
  }) => ({
    queryKey: ['group', args.groupKey, args.groupBy, args.params, args.body],
  }),
});
