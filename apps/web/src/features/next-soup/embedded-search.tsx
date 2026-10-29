import {
  type EntityData,
  ListEntityMetadataProvider,
  type SearchLocation,
} from '@entity';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import type { SearchFiltersState } from './core/search-filters';
import { createEmbeddedSearchSource } from './queries/embedded-search';
import { EmbeddedSearchResults } from './soup-view/embedded-search-results';
import { SearchFilterControls } from './soup-view/filters-bar/search/search-filters-row';
import { createSearchFiltersController } from './soup-view/filters-bar/search/search-filters-state';
import { SearchbarInput } from './soup-view/filters-bar/soup-view-search-bar';
import { createTagOptions } from './soup-view/filters-bar/tag-filter-state';

/** Global Search's editor, facets, and results with a transient host-owned draft. */
export function EmbeddedSearch(props: {
  query: string;
  onQueryChange: (value: string) => void;
  filters: SearchFiltersState;
  onFiltersChange: (value: SearchFiltersState) => void;
  enabled: boolean;
  scopeId: string;
  canHandleKeyboard?: Accessor<boolean>;
  onOpen: (
    entity: EntityData,
    newSplit: boolean,
    location?: SearchLocation
  ) => void;
}) {
  const controller = createSearchFiltersController({
    state: () => props.filters,
    onChange: props.onFiltersChange,
  });
  const tags = createTagOptions();
  const [paused, setPaused] = createSignal(false);
  const source = createEmbeddedSearchSource({
    text: () => props.query,
    filters: () => props.filters,
    enabled: () => props.enabled && !paused(),
  });
  const revision = createMemo(() =>
    JSON.stringify([props.query, props.filters])
  );
  let focus: (() => void) | undefined;
  return (
    <div class="space-y-3" aria-label="Global search">
      <SearchbarInput
        value={props.query}
        onChange={props.onQueryChange}
        label="Search for"
        placeholder="Search"
        onPauseChange={setPaused}
        onConnect={(controls) => {
          focus = () => controls.focus();
        }}
      />
      <SearchFilterControls
        controller={controller}
        tags={tags}
        onPickerClose={() => focus?.()}
      />
      <Show when={props.enabled && !source.needsKeywords()}>
        <ListEntityMetadataProvider tagSets={tags.tagSets}>
          <EmbeddedSearchResults
            items={source.items()}
            loading={source.loading()}
            error={source.error()}
            hasMore={source.hasMore()}
            loadingMore={source.loadingMore()}
            loadMore={source.loadMore}
            scopeId={props.scopeId}
            revision={revision()}
            canHandleKeyboard={() =>
              !paused() && props.canHandleKeyboard?.() !== false
            }
            onOpen={props.onOpen}
          />
        </ListEntityMetadataProvider>
      </Show>
    </div>
  );
}
