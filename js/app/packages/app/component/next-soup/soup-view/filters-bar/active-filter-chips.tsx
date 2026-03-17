import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { cn } from '@ui/utils/classname';
import { createSignal, For, type JSX, Show } from 'solid-js';
import XIcon from '@icon/regular/x.svg';
import CheckIcon from '@icon/regular/check.svg';
import type { FilterOption } from './unified-filter-dropdown';

export type ActiveFilter = {
  categoryId: string;
  categoryLabel: string;
  optionId: string;
  optionLabel: string;
  icon?: () => JSX.Element;
  /** Available options in this category for replacement */
  categoryOptions?: FilterOption[];
};

interface ActiveFilterChipsProps {
  filters: ActiveFilter[];
  onRemove: (categoryId: string, optionId: string) => void;
  onReplace: (
    categoryId: string,
    oldOptionId: string,
    newOptionId: string
  ) => void;
  onClearAll: () => void;
  /** Check if a filter option is currently active */
  isOptionActive: (optionId: string) => boolean;
}

const FilterChip = (props: {
  filter: ActiveFilter;
  onRemove: () => void;
  onReplace: (newOptionId: string) => void;
  isOptionActive: (optionId: string) => boolean;
}) => {
  const [open, setOpen] = createSignal(false);

  const hasOptions = () =>
    props.filter.categoryOptions && props.filter.categoryOptions.length > 0;

  return (
    <div
      class={cn(
        'inline-flex items-center text-xs rounded-md',
        'bg-ink/8 text-ink-muted border border-edge-muted',
        'transition-colors'
      )}
    >
      <Show
        when={hasOptions()}
        fallback={
          <span class="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5">
            <Show when={props.filter.icon}>
              {(icon) => (
                <span class="size-3 flex items-center justify-center shrink-0">
                  {icon()()}
                </span>
              )}
            </Show>
            <span class="font-medium">
              {props.filter.categoryLabel}: {props.filter.optionLabel}
            </span>
          </span>
        }
      >
        <DropdownMenu open={open()} onOpenChange={setOpen} gutter={4}>
          <DropdownMenu.Trigger
            class={cn(
              'inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-l-md',
              'hover:bg-ink/12 hover:text-ink transition-colors cursor-default'
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
              {props.filter.categoryLabel}: {props.filter.optionLabel}
            </span>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded-lg shadow-xl min-w-[160px] p-1">
              <For each={props.filter.categoryOptions}>
                {(option) => {
                  const active = () => props.isOptionActive(option.id);
                  return (
                    <DropdownMenu.Item
                      class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left text-xs transition-colors hover:bg-ink/5 outline-none data-[highlighted]:bg-ink/5 cursor-default"
                      onSelect={() => {
                        if (!active()) {
                          props.onReplace(option.id);
                        }
                      }}
                    >
                      <span
                        class={cn(
                          'size-4 flex items-center justify-center shrink-0 rounded border transition-colors',
                          active() ? 'bg-accent border-accent' : 'border-edge'
                        )}
                      >
                        <Show when={active()}>
                          <CheckIcon class="size-2.5 text-page" />
                        </Show>
                      </span>

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
          'inline-flex items-center justify-center px-1 py-0.5 rounded-r-md',
          'hover:bg-ink/12 hover:text-ink transition-colors'
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
                <FilterChip
                  filter={filter}
                  onRemove={() =>
                    props.onRemove(filter.categoryId, filter.optionId)
                  }
                  onReplace={(newOptionId) =>
                    props.onReplace(
                      filter.categoryId,
                      filter.optionId,
                      newOptionId
                    )
                  }
                  isOptionActive={props.isOptionActive}
                />
              }
            >
              <span class="inline-flex items-center gap-1.5">
                <FilterChip
                  filter={filter}
                  onRemove={() =>
                    props.onRemove(filter.categoryId, filter.optionId)
                  }
                  onReplace={(newOptionId) =>
                    props.onReplace(
                      filter.categoryId,
                      filter.optionId,
                      newOptionId
                    )
                  }
                  isOptionActive={props.isOptionActive}
                />
                <button
                  type="button"
                  class={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md whitespace-nowrap',
                    'text-ink-muted hover:text-ink hover:bg-hover transition-colors'
                  )}
                  onClick={() => props.onClearAll()}
                >
                  Clear all
                </button>
              </span>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
};
