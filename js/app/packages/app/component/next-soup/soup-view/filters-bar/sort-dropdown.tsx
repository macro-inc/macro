import { type Component, For, Show } from 'solid-js';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import CheckIcon from '@icon/regular/check.svg';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import SortIcon from '@macro-icons/wide/sort.svg';
import type {
  SortOption,
  SystemSortOption,
} from '@app/component/next-soup/soup-view/sort-options';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';

export interface SortDropdownProps {
  /** Current sort value */
  value: () => SystemSortOption;
  /** Handler for sort change */
  onChange: (value: SystemSortOption) => void;
  /** Available sort options (defaults to SORT_OPTIONS) */
  options: SortOption[];
  /** Controlled open state (optional - uses internal state if not provided) */
  open?: boolean;
  /** Controlled open state setter (optional - uses internal state if not provided) */
  onOpenChange?: (open: boolean) => void;
}

export const SortDropdown: Component<SortDropdownProps> = (props) => {
  const options = () => props.options ?? [];

  return (
    <DropdownMenu
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-start"
      gutter={4}
    >
      <DropdownMenu.Trigger
        as={Button}
        variant="secondary"
        size="sm"
        class="whitespace-nowrap rounded-xs [&_svg]:size-4"
      >
        <SortIcon />
        <ChevronDownIcon class="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded-sm shadow-sm min-w-[140px] p-1">
          <For each={options()}>
            {(option) => (
              <DropdownMenu.Item
                class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-ink/5 focus:bg-ink/5 outline-none cursor-default rounded-md"
                onSelect={() => props.onChange(option.value)}
              >
                <Show when={option.icon}>
                  {(icon) => (
                    <span class="size-3.5 flex items-center justify-center shrink-0 text-ink-muted">
                      {icon()()}
                    </span>
                  )}
                </Show>
                <span
                  class="flex-1 truncate"
                  classList={{
                    'text-ink font-medium': props.value() === option.value,
                    'text-ink-muted': props.value() !== option.value,
                  }}
                >
                  {option.label}
                </span>
                <span class="size-3.5 flex items-center justify-center shrink-0">
                  <Show when={props.value() === option.value}>
                    <CheckIcon class="size-3 text-accent" />
                  </Show>
                </span>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
};
