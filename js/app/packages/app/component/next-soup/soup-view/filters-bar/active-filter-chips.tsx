import { truncateLabel } from '@core/util/string';
import { Combobox } from '@kobalte/core/combobox';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import CheckIcon from '@phosphor/check.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, Layer } from '@ui';
import { type Accessor, createSignal, For, type JSX, Show } from 'solid-js';
import type { SearchableOption } from './search-filter-controls';
import { SearchableMultiSelect } from './searchable-multi-select';
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

const ChipContent = (props: {
  filter: ActiveFilter;
  hideCategoryLabel?: boolean;
}) => {
  const showCategory = () =>
    !(props.filter.hideCategoryLabel ?? props.hideCategoryLabel);
  return (
    <>
      <Show when={props.filter.icon}>
        {(icon) => (
          <span class="size-3 flex items-center justify-center shrink-0">
            {icon()()}
          </span>
        )}
      </Show>
      <span class="font-medium" title={props.filter.optionLabel()}>
        <Show when={showCategory()}>{props.filter.categoryLabel}: </Show>
        {truncateLabel(props.filter.optionLabel())}
      </span>
    </>
  );
};

const ChipRemoveButton = (props: { onRemove: () => void }) => (
  <button
    type="button"
    class={cn(
      'inline-flex items-center justify-center px-1',
      'not-disabled:hover:bg-ink/10 not-disabled:active:bg-ink/12'
    )}
    onClick={(e) => {
      e.stopPropagation();
      props.onRemove();
    }}
  >
    <XIcon class="size-3" />
  </button>
);

const SearchableFilterChip = (props: {
  filter: ActiveFilter;
  onRemove: () => void;
  chipClass?: string;
  hideCategoryLabel?: boolean;
}) => {
  const options: Accessor<SearchableOption[]> = () =>
    props.filter.searchableOptions?.() ?? [];
  const activeIds: Accessor<string[]> = () =>
    props.filter.activeSearchableIds?.() ?? [];

  const handleChange = (ids: string[]) => {
    props.filter.onSearchableChange?.(ids);
  };

  const placeholder =
    props.filter.searchPlaceholder ??
    `Search ${props.filter.categoryLabel.toLowerCase()}...`;

  return (
    <Layer depth={0}>
      <div
        class={cn(
          'h-6 inline-flex items-stretch overflow-hidden text-xs font-medium leading-none whitespace-nowrap rounded-sm',
          'bg-transparent text-ink border border-edge-muted',
          props.chipClass
        )}
      >
        <SearchableMultiSelect
          options={options}
          activeIds={activeIds}
          onChange={handleChange}
          placeholder={placeholder}
          placement="bottom-start"
          open={props.filter.isPopupOpen}
          onOpenChange={(v) => props.filter.setPopupOpen?.(v)}
        >
          <Combobox.Trigger class="inline-flex h-full items-center gap-1.5 px-2 leading-none not-disabled:hover:bg-ink/10 not-disabled:active:bg-ink/12">
            <ChipContent
              filter={props.filter}
              hideCategoryLabel={props.hideCategoryLabel}
            />
          </Combobox.Trigger>
        </SearchableMultiSelect>

        <ChipRemoveButton onRemove={props.onRemove} />
      </div>
    </Layer>
  );
};

const FilterChip = (props: {
  filter: ActiveFilter;
  onRemove: () => void;
  onReplace: (newOptionId: string) => void;
  isOptionActive: (optionId: string) => boolean;
  chipClass?: string;
  hideCategoryLabel?: boolean;
}) => {
  const [open, setOpen] = createSignal(false);

  const hasOptions = () =>
    props.filter.categoryOptions && props.filter.categoryOptions.length > 0;

  return (
    <Layer depth={0}>
      <div
        class={cn(
          'h-6 inline-flex items-stretch overflow-hidden text-xs font-medium leading-none whitespace-nowrap rounded-sm',
          'bg-transparent text-ink border border-edge-muted',
          props.chipClass
        )}
      >
        <Show
          when={hasOptions()}
          fallback={
            <span class="inline-flex items-center gap-1.5 pxl-2 pr-1 py-1">
              <ChipContent
                filter={props.filter}
                hideCategoryLabel={props.hideCategoryLabel}
              />
            </span>
          }
        >
          <DropdownMenu open={open()} onOpenChange={setOpen} gutter={4}>
            <DropdownMenu.Trigger class="inline-flex items-center gap-1.5 px-2 leading-none not-disabled:hover:bg-ink/10 not-disabled:active:bg-ink/12">
              <ChipContent
                filter={props.filter}
                hideCategoryLabel={props.hideCategoryLabel}
              />
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <Layer depth={2}>
                <DropdownMenu.Content class="z-action-menu bg-surface border border-edge-muted rounded-sm shadow-xl min-w-40 p-1">
                  <For each={props.filter.categoryOptions}>
                    {(option) => {
                      const active = () =>
                        props.filter.isOptionActive
                          ? props.filter.isOptionActive(option.id)
                          : props.isOptionActive(option.id);
                      const isSingleSelect = () =>
                        props.filter.multiple === false;
                      return (
                        <DropdownMenu.Item
                          class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left text-xs transition-colors hover:bg-ink/5 outline-none data-highlighted:bg-ink/5 cursor-default"
                          onSelect={() => {
                            if (active()) return;
                            if (props.filter.onReplace) {
                              props.filter.onReplace(option.id);
                            } else {
                              props.onReplace(option.id);
                            }
                          }}
                        >
                          <Show
                            when={isSingleSelect()}
                            fallback={
                              <span
                                class={cn(
                                  'size-4 flex items-center justify-center shrink-0 rounded border transition-colors',
                                  active()
                                    ? 'bg-accent border-accent'
                                    : 'border-edge'
                                )}
                              >
                                <Show when={active()}>
                                  <CheckIcon class="size-2.5 text-surface" />
                                </Show>
                              </span>
                            }
                          >
                            <span
                              class={cn(
                                'size-4 flex items-center justify-center shrink-0 rounded-full border transition-colors',
                                active()
                                  ? 'bg-accent border-accent'
                                  : 'border-edge'
                              )}
                            >
                              <Show when={active()}>
                                <CheckIcon class="size-2.5 text-surface" />
                              </Show>
                            </span>
                          </Show>

                          <Show when={option.icon}>
                            {(icon) => (
                              <span class="size-4 flex items-center justify-center shrink-0">
                                {icon()()}
                              </span>
                            )}
                          </Show>

                          <span
                            class={cn(
                              'flex-1 truncate',
                              active() ? 'text-ink' : 'text-ink-muted'
                            )}
                          >
                            {option.label}
                          </span>
                        </DropdownMenu.Item>
                      );
                    }}
                  </For>
                </DropdownMenu.Content>
              </Layer>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </Show>

        <ChipRemoveButton onRemove={props.onRemove} />
      </div>
    </Layer>
  );
};

export const ActiveFilterChips = (props: ActiveFilterChipsProps) => {
  const lastIndex = () => props.filters.length - 1;

  const renderChip = (filter: ActiveFilter) => {
    const onRemove = () => {
      if (filter.onRemove) {
        filter.onRemove();
      } else {
        props.onRemove(filter.optionId());
      }
    };

    return (
      <Show
        when={filter.searchableOptions}
        fallback={
          <FilterChip
            filter={filter}
            onRemove={onRemove}
            onReplace={(newOptionId) =>
              props.onReplace(filter.optionId(), newOptionId)
            }
            isOptionActive={props.isOptionActive}
            chipClass={props.chipClass}
            hideCategoryLabel={props.hideCategoryLabel}
          />
        }
      >
        <SearchableFilterChip
          filter={filter}
          onRemove={onRemove}
          chipClass={props.chipClass}
          hideCategoryLabel={props.hideCategoryLabel}
        />
      </Show>
    );
  };

  return (
    <Show when={props.filters.length > 0}>
      <div class="flex items-center gap-2 flex-wrap">
        <For each={props.filters}>
          {(filter, index) => (
            // To make sure that the Clear all button never wraps to a new line on its own, we wrap it with the last FilterChip
            <Show
              when={props.filters.length > 1 && index() === lastIndex()}
              fallback={renderChip(filter)}
            >
              <span class="inline-flex items-center gap-1.5">
                {renderChip(filter)}
                <Button
                  onClick={() => props.onClearAll()}
                  variant="base"
                  size="sm"
                >
                  <XIcon class="size-3!" />
                  Clear
                </Button>
              </span>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
};
