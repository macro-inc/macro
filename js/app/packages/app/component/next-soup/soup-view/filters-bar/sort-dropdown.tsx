import type {
  SortOption,
  SystemSortOption,
} from '@app/component/next-soup/soup-view/sort-options';
import { TOKENS } from '@core/hotkey/tokens';
import SortIcon from '@phosphor-icons/core/regular/funnel-simple.svg?component-solid';
import { Dropdown, SingleSelectCheck, Tooltip } from '@ui';
import { type Component, For, Show } from 'solid-js';

interface SortDropdownProps {
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
    >
      <Tooltip label="Sort" hotkey={TOKENS.soup.sort}>
        <Dropdown.Trigger depth={2} class="bg-surface">
          <SortIcon />
          <span>Sort</span>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={options()}>
            {(option) => (
              <Dropdown.Item onSelect={() => props.onChange(option.value)}>
                <Show when={option.icon}>
                  {(icon) => (
                    <span class="size-3.5 flex items-center justify-center shrink-0 text-ink-muted">
                      {icon()()}
                    </span>
                  )}
                </Show>
                <span class="flex-1 truncate">{option.label}</span>
                <SingleSelectCheck active={props.value() === option.value} />
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};
