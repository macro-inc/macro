import { type Accessor, createSignal, For } from 'solid-js';
import type { TagFilter } from '../tag-filter-state';
import { SearchFacetChip } from './search-facet-chip';
import { useSearchFacets } from './search-facets';
import type { SearchFiltersController } from './search-filters-state';

/** The global Search facet controls, with host-owned state and focus. */
export function SearchFilterControls(props: {
  controller: SearchFiltersController;
  tags?: Pick<TagFilter, 'hasTags' | 'options' | 'defByOption'>;
  typeMenuOpen?: Accessor<boolean>;
  setTypeMenuOpen?: (open: boolean) => void;
  onPickerClose?: () => void;
}) {
  const facets = useSearchFacets(props.controller, props.tags);
  return (
    <div
      aria-label="Search filters"
      class="flex items-center gap-1.5 flex-wrap min-w-0"
    >
      <For each={facets()}>
        {(facet) => (
          <SearchFacetChip
            facet={facet}
            onPickerClose={props.onPickerClose}
            open={facet.id === 'type' ? props.typeMenuOpen : undefined}
            setOpen={facet.id === 'type' ? props.setTypeMenuOpen : undefined}
          />
        )}
      </For>
    </div>
  );
}
