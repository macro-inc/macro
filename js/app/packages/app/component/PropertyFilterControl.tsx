import type { Component } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { FilterPropertyPill } from './PropertyFilter';
import type { PropertyFilter } from './PropertyFilterTypes';
import { checkFilterConflict } from './PropertyFilterTypes';

type FilterEntry = {
  id: string;
  data: PropertyFilter | null; // null = pending/editing, non-null = complete
};

export const PropertyFilterControl: Component = () => {
  // All filters (both pending and complete)
  const [filters, setFilters] = createStore<FilterEntry[]>([]);

  const addFilter = () => {
    setFilters((prev) => [...prev, { id: crypto.randomUUID(), data: null }]);
  };

  const removeFilter = (id: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== id));
  };

  const updateFilter = (id: string, data: PropertyFilter) => {
    setFilters((f) => f.id === id, 'data', data);
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

  return (
    <div class="flex flex-col gap-1">
      {/* Conflict warnings */}
      <Show when={conflictErrors().length > 0}>
        <div class="text-xs text-failure bg-failure/10 border border-failure px-2 py-1 mb-1">
          <For each={conflictErrors()}>{(error) => <div>{error}</div>}</For>
        </div>
      </Show>

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
