import type { Accessor } from 'solid-js';
import type { SearchableOption } from './searchable-multi-select';

/** Query-driven option lists that grow by a page as they scroll. Keep selected
 * values in options even when they are not visible; a search or page change
 * must not clear controlled selection. */
export type SearchableOptionSource<TId extends string = string> = {
  options: Accessor<SearchableOption<TId>[]>;
  /** Identity of the list on screen, absent while a new list is pending;
   * appending a page keeps it. */
  windowKey: Accessor<string | undefined>;
  search: Accessor<string>;
  setSearch: (query: string) => void;
  visibleIds: Accessor<readonly TId[]>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
  incomplete: Accessor<boolean>;
  hasNext: Accessor<boolean>;
  /** Lists the next page below the earlier ones. */
  next: () => void;
  retry: () => Promise<unknown>;
};
export type SearchableOptionSourceFactory<TId extends string = string> = (
  selected: Accessor<readonly TId[]>,
  enabled: Accessor<boolean>
) => SearchableOptionSource<TId>;
