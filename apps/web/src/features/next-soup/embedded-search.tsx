import {
  type EntityData,
  ListEntityMetadataProvider,
  type SearchLocation,
} from '@entity';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import type { SearchOperatorBinding } from './core/search-operators';
import { createEmbeddedSearchSource } from './queries/embedded-search';
import { EmbeddedSearchResults } from './soup-view/embedded-search-results';
import { SearchbarInput } from './soup-view/filters-bar/soup-view-search-bar';
import { createTagOptions } from './soup-view/filters-bar/tag-filter-state';
import { createSearchOperatorLookup } from './soup-view/search-operator-lookup';

/**
 * Global Search's editor and results with a transient host-owned draft. The
 * field holds the whole search, filters typed as operators, as the Search
 * view's does.
 */
export function EmbeddedSearch(props: {
  query: string;
  /** What the query's tokens stand for, by id. */
  bindings: readonly SearchOperatorBinding[];
  onQueryChange: (value: string) => void;
  enabled: boolean;
  scopeId: string;
  canHandleKeyboard?: Accessor<boolean>;
  onOpen: (
    entity: EntityData,
    newSplit: boolean,
    location?: SearchLocation
  ) => void;
}) {
  const tags = createTagOptions();
  const [paused, setPaused] = createSignal(false);
  const source = createEmbeddedSearchSource({
    text: () => props.query,
    bindings: () => props.bindings,
    enabled: () => props.enabled && !paused(),
    operatorLookup: createSearchOperatorLookup(tags),
  });
  const revision = createMemo(() =>
    JSON.stringify([props.query, props.bindings])
  );
  return (
    <div class="space-y-3" aria-label="Global search">
      <SearchbarInput
        operators
        value={props.query}
        bindings={props.bindings}
        onChange={props.onQueryChange}
        label="Search for"
        placeholder="Search"
        onPauseChange={setPaused}
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
