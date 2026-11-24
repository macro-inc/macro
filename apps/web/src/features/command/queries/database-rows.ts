import {
  type DatabaseRowMatch,
  databaseRowSearchQueryOptions,
} from '@app/features/block-database/queries/row-search';
import { debouncedDependent } from '@core/util/debounce';
import { validateSearchServiceText } from '@queries/soup/search';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

/** Rows wait for a pause in typing: each term is a server search. */
export const DATABASE_ROW_SEARCH_DEBOUNCE_MS = 250;

/** Database rows matching the typed query, for a menu that lists them. */
export type DatabaseRowSource = {
  rows: Accessor<DatabaseRowMatch[]>;
  /** A search for the current term has not answered yet. */
  isLoading: Accessor<boolean>;
};

/** Searches the server for rows while `active`; inactive, it sends nothing
 * and lists nothing. */
export function useDatabaseRowSearch(
  query: Accessor<string>,
  active: Accessor<boolean>
): DatabaseRowSource {
  const term = debouncedDependent(
    () => query().trim(),
    DATABASE_ROW_SEARCH_DEBOUNCE_MS
  );
  const enabled = () => active() && validateSearchServiceText(term());
  const search = useQuery(() =>
    databaseRowSearchQueryOptions(term(), enabled())
  );
  return {
    rows: () => (enabled() && search.isSuccess ? search.data : []),
    isLoading: () => enabled() && search.isLoading,
  };
}
