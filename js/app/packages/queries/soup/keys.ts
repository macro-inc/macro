import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { SoupAstItemsQueryArgs, SoupItemsQueryArgs } from './items';
import type { SearchSoupQueryArgs } from './search';

/**
 * Marker appended to per-group infinite query keys so they sit under the
 * `astItems` prefix (and get swept by bulk soup operations) while still
 * being identifiable when an op needs to skip or specially target them.
 */
export const GROUPED_SUBQUERY_MARKER = '__groupedSubquery__' as const;

export const isGroupedSubqueryKey = (key: readonly unknown[]): boolean =>
  key.includes(GROUPED_SUBQUERY_MARKER);

export const soupKeys = createQueryKeys('soup', {
  items: (args: SoupItemsQueryArgs) => ({
    queryKey: [args.params, args.body],
  }),
  astItems: (args: SoupAstItemsQueryArgs) => ({
    queryKey: [args.params, args.body, args.groupBy],
  }),
  search: (args: SearchSoupQueryArgs) => ({
    queryKey: [args.params, args.body],
  }),
});
