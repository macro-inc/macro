import type { Accessor, Component } from 'solid-js';
import { createEffect, createMemo, For, on, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { FilterPropertyPill } from './PropertyFilter';
import type { PropertyFilter } from './PropertyFilterTypes';
import { checkFilterConflict } from './PropertyFilterTypes';

type FilterEntry = {
  id: string;
  data: PropertyFilter | null; // null = incomplete, non-null = complete
};

type PropertyFilterControlProps = {
  propertyFilters: Accessor<PropertyFilter[]>;
  setPropertyFilters: (filters: PropertyFilter[]) => void;
  /** Called when incomplete filter state changes */
  onIncompleteFiltersChange?: (hasIncomplete: boolean) => void;
};

export const PropertyFilterControl: Component<PropertyFilterControlProps> = (
  props
) => {
  // Simple incrementing ID generator (unique within component lifetime)
  let nextFilterId = 0;
  const getNextFilterId = () => `property-filter-${nextFilterId++}`;

  // Check if a filter has all required fields: propertyId, action, and value(s)
  const isFilterComplete = (
    filter: PropertyFilter | null
  ): filter is PropertyFilter => {
    if (!filter) return false;
    if (!filter.propertyId || !filter.action) return false;

    // Check value based on filter variant
    if ('value' in filter) {
      // BOOLEAN value can be false, so check for undefined/null only
      return filter.value !== undefined && filter.value !== null;
    }
    if ('values' in filter) {
      return Array.isArray(filter.values) && filter.values.length > 0;
    }

    return false;
  };

  // Extract only complete filters
  const getCompleteFilters = (entries: FilterEntry[]): PropertyFilter[] =>
    entries.filter((f) => isFilterComplete(f.data)).map((f) => f.data!);

  // Convert saved filters to entries with stable IDs
  const createEntriesFromProps = (): FilterEntry[] =>
    props.propertyFilters().map((f) => ({
      id: getNextFilterId(),
      data: f,
    }));

  // Local state for UI (includes incomplete filters)
  const [filters, setFilters] = createStore<FilterEntry[]>(
    createEntriesFromProps()
  );

  // Sync from props when they change externally (e.g., CLEAR button)
  createEffect(
    on(
      () => props.propertyFilters(),
      (propFilters) => {
        // If props are empty but we have filters, it's a CLEAR
        if (propFilters.length === 0 && filters.length > 0) {
          setFilters(reconcile([]));
        }
      },
      { defer: true } // Don't run on initial mount
    )
  );

  // Sync only complete filters to props
  const syncCompleteFiltersToProps = (entries: FilterEntry[]) => {
    props.setPropertyFilters(getCompleteFilters(entries));
  };

  const addFilter = () => {
    const newId = getNextFilterId();
    setFilters([...filters, { id: newId, data: null }]);
  };

  const removeFilter = (id: string) => {
    const newFilters = filters.filter((f) => f.id !== id);
    setFilters(reconcile(newFilters));
    // Sync complete filters to props
    syncCompleteFiltersToProps(newFilters);
  };

  const updateFilter = (id: string, data: PropertyFilter) => {
    const newFilters = filters.map((f) => (f.id === id ? { ...f, data } : f));
    setFilters(reconcile(newFilters));
    // Sync complete filters to props
    syncCompleteFiltersToProps(newFilters);
  };

  // Check for conflicts among all saved filters
  const conflictErrors = createMemo(() => {
    const completed = filters
      .filter((f) => f.data !== null)
      .map((f) => f.data!);
    const errors: string[] = [];

    for (let i = 0; i < completed.length; i++) {
      const filtersBefore = completed.slice(0, i);
      const conflict = checkFilterConflict(completed[i], filtersBefore);
      if (conflict) {
        errors.push(conflict);
      }
    }

    return errors;
  });

  // Check if there are any incomplete filters
  const hasIncompleteFilters = createMemo(() =>
    filters.some((f) => !isFilterComplete(f.data))
  );

  // Notify parent when incomplete filter state changes
  createEffect(() => {
    props.onIncompleteFiltersChange?.(hasIncompleteFilters());
  });

  return (
    <div class="flex flex-col gap-1">
      {/* Conflict warnings */}
      <Show when={conflictErrors().length > 0}>
        <div class="text-xs text-failure bg-failure/10 border border-failure px-2 py-1 mb-1">
          <For each={conflictErrors()}>{(error) => <div>{error}</div>}</For>
        </div>
      </Show>

      {/* TODO: Optimization opportunity - fetch properties once here and pass
          initialProperty to each pill to avoid N API calls on restore.
          Also add controlled editing state (editingPropertyId) so only one
          dropdown is open at a time. */}
      <For each={filters}>
        {(filter, index) => (
          <>
            <FilterPropertyPill
              id={filter.id}
              savedData={filter.data}
              onSave={(data) => updateFilter(filter.id, data)}
              onCancel={() => removeFilter(filter.id)}
            />
            <Show when={index() < filters.length - 1}>
              <span class="text-[10px] text-ink-muted font-mono pl-3 pt-0.25 leading-none">
                AND
              </span>
            </Show>
          </>
        )}
      </For>

      {/* Add filter button */}
      <button
        type="button"
        onClick={addFilter}
        class={`px-2 py-0.75 ${filters.length > 0 ? 'mt-2' : ''} text-xs text-ink border border-edge hover:bg-hover w-full`}
      >
        + Add filter
      </button>
    </div>
  );
};

export default PropertyFilterControl;
