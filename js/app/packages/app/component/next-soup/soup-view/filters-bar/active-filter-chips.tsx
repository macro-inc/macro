import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Combobox } from '@kobalte/core/combobox';
import { cn } from '@ui/utils/classname';
import { type Accessor, createSignal, For, type JSX, Show } from 'solid-js';
import XIcon from '@icon/regular/x.svg';
import CheckIcon from '@icon/regular/check.svg';
import type { FilterOption } from './unified-filter-dropdown';
import type { SearchableOption } from './search-filter-controls';
import { SearchableMultiSelect } from './searchable-multi-select';
import { Button } from '@ui/components/Button';

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
    <div
      class={cn(
        'flex text-xs rounded-xs',
        'bg-ink/10 text-ink-muted border border-edge-muted',
        'group transition-colors',
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
        <Combobox.Trigger
          class={cn(
            'inline-flex items-center gap-1.5 pl-2 pr-1 py-1',
            'hover:text-ink hover:bg-edge-muted'
          )}
        >
          <Show when={props.filter.icon}>
            {(icon) => (
              <span class="size-3 flex items-center justify-center shrink-0">
                {icon()()}
              </span>
            )}
          </Show>
          <span class="font-medium">
            <Show when={!props.hideCategoryLabel}>
              {props.filter.categoryLabel}:{' '}
            </Show>
            {props.filter.optionLabel()}
          </span>
        </Combobox.Trigger>
      </SearchableMultiSelect>

      <button
        type="button"
        class={cn(
          'px-1 min-h-full',
          'hover:bg-edge-muted hover:text-ink transition-colors'
        )}
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
      >
        <XIcon class="size-3" />
      </button>
    </div>
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
    <div
      class={cn(
        'flex text-xs rounded-xs',
        'bg-ink/10 text-ink-muted border border-edge-muted',
        'group',
        'transition-colors',
        props.chipClass
      )}
    >
      <Show
        when={hasOptions()}
        fallback={
          <span class="inline-flex items-center gap-1.5 pl-2 pr-1 py-1">
            <Show when={props.filter.icon}>
              {(icon) => (
                <span class="size-3 flex items-center justify-center shrink-0">
                  {icon()()}
                </span>
              )}
            </Show>
            <span class="font-medium">
              <Show when={!props.hideCategoryLabel}>
                {props.filter.categoryLabel}:{' '}
              </Show>
              {props.filter.optionLabel()}
            </span>
          </span>
        }
      >
        <DropdownMenu open={open()} onOpenChange={setOpen} gutter={4}>
          <DropdownMenu.Trigger
            class={cn(
              'inline-flex items-center gap-1.5 pl-2 pr-1 py-1',
              'hover:text-ink hover:bg-edge-muted'
            )}
          >
            <Show when={props.filter.icon}>
              {(icon) => (
                <span class="size-3 flex items-center justify-center shrink-0">
                  {icon()()}
                </span>
              )}
            </Show>
            <span class="font-medium">
              <Show when={!props.hideCategoryLabel}>
                {props.filter.categoryLabel}:{' '}
              </Show>
              {props.filter.optionLabel()}
            </span>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded-sm shadow-xl min-w-[160px] p-1">
              <For each={props.filter.categoryOptions}>
                {(option) => {
                  const active = () =>
                    props.filter.isOptionActive
                      ? props.filter.isOptionActive(option.id)
                      : props.isOptionActive(option.id);
                  const isSingleSelect = () => props.filter.multiple === false;
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
                              <CheckIcon class="size-2.5 text-page" />
                            </Show>
                          </span>
                        }
                      >
                        <span
                          class={cn(
                            'size-4 flex items-center justify-center shrink-0 rounded-full border transition-colors',
                            active() ? 'bg-accent border-accent' : 'border-edge'
                          )}
                        >
                          <Show when={active()}>
                            <CheckIcon class="size-2.5 text-page" />
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
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>

      {/* Remove button */}
      <button
        type="button"
        class={cn(
          'px-1 min-h-full',
          'hover:bg-edge-muted hover:text-ink transition-colors'
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (props.filter.onRemove) {
            props.filter.onRemove();
          } else {
            props.onRemove();
          }
        }}
      >
        <XIcon class="size-3" />
      </button>
    </div>
  );
};

export const ActiveFilterChips = (props: ActiveFilterChipsProps) => {
  const lastIndex = () => props.filters.length - 1;

  return (
    <Show when={props.filters.length > 0}>
      <div class="flex items-center gap-1.5 flex-wrap px-2">
        <For each={props.filters}>
          {(filter, index) => (
            // To make sure that the Clear all button never wraps to a new line on its own, we wrap it with the last FilterChip
            <Show
              when={props.filters.length > 1 && index() === lastIndex()}
              fallback={
                <Show
                  when={filter.searchableOptions}
                  fallback={
                    <FilterChip
                      filter={filter}
                      onRemove={() => props.onRemove(filter.optionId())}
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
                    onRemove={() => {
                      if (filter.onRemove) {
                        filter.onRemove();
                      } else {
                        props.onRemove(filter.optionId());
                      }
                    }}
                    chipClass={props.chipClass}
                    hideCategoryLabel={props.hideCategoryLabel}
                  />
                </Show>
              }
            >
              <span class="inline-flex items-center gap-1.5">
                <Show
                  when={filter.searchableOptions}
                  fallback={
                    <FilterChip
                      filter={filter}
                      onRemove={() => props.onRemove(filter.optionId())}
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
                    onRemove={() => {
                      if (filter.onRemove) {
                        filter.onRemove();
                      } else {
                        props.onRemove(filter.optionId());
                      }
                    }}
                    chipClass={props.chipClass}
                    hideCategoryLabel={props.hideCategoryLabel}
                  />
                </Show>
                <Button
                  class={cn(
                    'rounded-xs whitespace-nowrap'
                    // 'text-ink-muted hover:text-ink hover:bg-hover transition-colors'
                  )}
                  size="sm"
                  variant="ghost"
                  onClick={() => props.onClearAll()}
                >
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
