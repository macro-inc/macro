import type {
  SortOption,
  SystemSortOption,
} from '@app/component/next-soup/soup-view/sort-options';
import { TOKENS } from '@core/hotkey/tokens';
import CheckIcon from '@icon/regular/check.svg';
import SortIcon from '@phosphor-icons/core/regular/funnel-simple.svg?component-solid';
import { Dropdown, Layer, Tooltip } from '@ui';
import { type Component, For, Show } from 'solid-js';

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
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-start"
      gutter={4}
    >
      <Tooltip label="Sort" hotkey={TOKENS.soup.sort}>
        <Dropdown.Trigger>
          <SortIcon />
          <span>Sort</span>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Portal>
        <Layer depth={2}>
          <Dropdown.Content class="z-action-menu bg-surface border border-edge-muted rounded-sm shadow-sm min-w-35 p-1">
            <For each={options()}>
              {(option) => (
                <Dropdown.Item
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
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Content>
        </Layer>
      </Dropdown.Portal>
    </Dropdown>
  );
};
