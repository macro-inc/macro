import type { Accessor } from 'solid-js';
import type { SearchableOption } from './searchable-multi-select';

/** Query-driven option windows. Keep selected values in options even when they
 * are not visible; a search/page change must not clear controlled selection. */
export type SearchableOptionSource<TId extends string = string> = {
  options: Accessor<SearchableOption<TId>[]>;
  /** Identity of the committed page, absent while a replacement is pending. */
  windowKey: Accessor<string | undefined>;
  search: Accessor<string>;
  setSearch: (query: string) => void;
  visibleIds: Accessor<readonly TId[]>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
  incomplete: Accessor<boolean>;
  hasNext: Accessor<boolean>;
  next: () => void;
  retry: () => Promise<unknown>;
};
export type SearchableOptionSourceFactory<TId extends string = string> = (
  selected: Accessor<readonly TId[]>,
  enabled: Accessor<boolean>
) => SearchableOptionSource<TId>;
