import { useTagFilter } from '@app/component/next-soup/soup-view/filters-bar/tag-filter';
import { useMaybeSoupView } from '@app/component/next-soup/soup-view/soup-view-context';

/**
 * Row-tag click handler: filter the current list to a single tag. Applied on
 * top of the active tab and any other filters — only the tag filter itself is
 * replaced, so it is always exactly the one clicked tag. Returns undefined
 * outside a soup view (e.g. document embeds), where there is nothing to filter.
 */
export function useRowTagFilter(): ((optionId: string) => void) | undefined {
  const soupView = useMaybeSoupView();
  if (!soupView) return undefined;
  const tagFilter = useTagFilter();
  return (optionId: string) => {
    tagFilter.onChange([optionId]);
  };
}
