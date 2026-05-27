import { type Accessor, For, type JSX, Show } from 'solid-js';
import {
  type ConsolidatedFilter,
  ConsolidatedFilterChip,
  type FilterValue,
} from './consolidated-filter-chip';
import type { SearchableOption } from './search-filter-controls';
import type { FilterOption } from './unified-filter-dropdown';

export type ActiveFilter = {
  categoryLabel: string;
  /**
   * Accessor returning the current filter id. Wrapped as an accessor so that
   * multi-select chips (In/From) can keep stable object identity across
   * selection toggles — the id string changes but the chip component doesn't
   * remount, preserving its internal state (open, search text).
   */
  optionId: Accessor<string>;
  /** Accessor returning the current display label. See `optionId` for rationale. */
  optionLabel: Accessor<string>;
  icon?: () => JSX.Element;
  /** Available options in this category for replacement */
  categoryOptions?: FilterOption[];
  /** When false, the chip dropdown renders radio-style indicators instead of checkboxes. */
  multiple?: boolean;
  /**
   * Per-chip remove handler. When present, takes precedence over the shared
   * `onRemove` prop on `ActiveFilterChips`. Use this for filters that live
   * outside `soup.filters` (e.g. assigneeFilter).
   */
  onRemove?: () => void;
  /**
   * Per-chip replace handler. When present, takes precedence over the shared
   * `onReplace` prop on `ActiveFilterChips`. Use this for filters that need
   * side effects beyond toggling `soup.filters` (e.g. updating queryFilters).
   */
  onReplace?: (newOptionId: string) => void;
  /**
   * Per-chip active-state predicate. When set, takes precedence over the shared
   * `isOptionActive` for this chip's dropdown. Use when the filter state lives
   * outside `soup.filters` (e.g. email importance in queryFilters).
   */
  isOptionActive?: (optionId: string) => boolean;
  /**
   * When set, the chip opens a searchable multi-select combobox instead of the
   * simple replace dropdown. Use for list-valued filters like In/From.
   */
  searchableOptions?: Accessor<SearchableOption[]>;
  /** Currently-active ids for the searchable chip, used to render selection state. */
  activeSearchableIds?: Accessor<string[]>;
  /** Called with the new full id list when the searchable selection changes. */
  onSearchableChange?: (ids: string[]) => void;
  /** Placeholder for the searchable chip's search input. */
  searchPlaceholder?: string;
  /**
   * Optional controlled popup open state. When provided, the upstream can
   * keep the chip mounted while the popup is still open even if the chip's
   * active selections drop to zero (so toggling A off then B on in the same
   * session doesn't close the menu).
   */
  isPopupOpen?: Accessor<boolean>;
  setPopupOpen?: (v: boolean) => void;
  /** Per-chip override for the container-level `hideCategoryLabel`. */
  hideCategoryLabel?: boolean;
};

interface ActiveFilterChipsProps {
  filters: ActiveFilter[];
  onRemove: (optionId: string) => void;
  onReplace: (oldOptionId: string, newOptionId: string) => void;
  onClearAll: () => void;
  /** Check if a filter option is currently active */
  isOptionActive: (optionId: string) => boolean;
  /** Extra class applied to each chip wrapper */
  chipClass?: string;
  /** Hide the "Category: " prefix in each chip label */
  hideCategoryLabel?: boolean;
}

/**
 * Convert an ActiveFilter to a ConsolidatedFilter for use with ConsolidatedFilterChip.
 */
function toConsolidatedFilter(
  filter: ActiveFilter,
  containerProps: {
    onRemove: (optionId: string) => void;
    onReplace: (oldOptionId: string, newOptionId: string) => void;
    isOptionActive: (optionId: string) => boolean;
  }
): ConsolidatedFilter {
  // Build values accessor - for searchable filters, derive from activeSearchableIds
  // For regular filters, use the single optionId/optionLabel
  const values: Accessor<FilterValue[]> = filter.searchableOptions
    ? () => {
        const ids = filter.activeSearchableIds?.() ?? [];
        const options = filter.searchableOptions?.() ?? [];
        const result: FilterValue[] = [];
        for (const id of ids) {
          const opt = options.find((o) => o.id === id);
          if (opt) {
            result.push({ id: opt.id, label: opt.label, icon: opt.icon });
          }
        }
        return result;
      }
    : () => [
        {
          id: filter.optionId(),
          label: filter.optionLabel(),
          icon: filter.icon,
        },
      ];

  // Convert categoryOptions to availableOptions
  const availableOptions: FilterValue[] | undefined =
    filter.categoryOptions?.map((opt) => ({
      id: opt.id,
      label: opt.label,
      icon: opt.icon,
    }));

  const isValueActive = filter.isOptionActive ?? containerProps.isOptionActive;

  const onToggleValue = (valueId: string) => {
    if (filter.onReplace) {
      filter.onReplace(valueId);
    } else {
      containerProps.onReplace(filter.optionId(), valueId);
    }
  };

  const onRemoveAll = () => {
    if (filter.onRemove) {
      filter.onRemove();
    } else {
      containerProps.onRemove(filter.optionId());
    }
  };

  return {
    key: `${filter.categoryLabel}-${filter.optionId()}`,
    categoryLabel: filter.categoryLabel,
    values,
    availableOptions,
    multiple: filter.multiple,
    isValueActive,
    onToggleValue,
    onRemoveAll,
    // Searchable filter props
    searchableOptions: filter.searchableOptions,
    activeSearchableIds: filter.activeSearchableIds,
    onSearchableChange: filter.onSearchableChange,
    searchPlaceholder: filter.searchPlaceholder,
    isPopupOpen: filter.isPopupOpen,
    setPopupOpen: filter.setPopupOpen,
  };
}

export const ActiveFilterChips = (props: ActiveFilterChipsProps) => {
  const containerProps = () => ({
    onRemove: props.onRemove,
    onReplace: props.onReplace,
    isOptionActive: props.isOptionActive,
  });

  const hideCategoryLabel = () => props.hideCategoryLabel;

  const renderChip = (filter: ActiveFilter) => {
    const consolidated = toConsolidatedFilter(filter, containerProps());
    // Merge per-filter hideCategoryLabel with container-level setting
    const shouldHideCategory = filter.hideCategoryLabel ?? hideCategoryLabel();

    return (
      <ConsolidatedFilterChip
        filter={consolidated}
        class={props.chipClass}
        hideCategoryLabel={shouldHideCategory}
      />
    );
  };

  return (
    <Show when={props.filters.length > 0}>
      <div class="flex items-center gap-2 flex-wrap">
        <For each={props.filters}>{(filter) => renderChip(filter)}</For>
      </div>
    </Show>
  );
};
