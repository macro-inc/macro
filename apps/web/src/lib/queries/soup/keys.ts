import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { GroupByField } from './grouped/types';
import type { SoupAstItemsQueryArgs } from './items';
import type { SearchSoupQueryArgs } from './search';

export const soupKeys = createQueryKeys('soup', {
  crmPeople: (teamId: string) => [teamId],
  /** Lists read outside `astItems` (recently viewed); mutations refresh them. */
  items: (args: Pick<SoupAstItemsQueryArgs, 'params' | 'body'>) => ({
    queryKey: [args.params, args.body],
  }),
  astItems: (args: SoupAstItemsQueryArgs) => ({
    queryKey: [args.params, args.body, args.groupBy, args.transport],
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
