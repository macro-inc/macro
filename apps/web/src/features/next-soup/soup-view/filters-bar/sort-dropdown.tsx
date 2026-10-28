import type {
  SortOption,
  SystemSortOption,
} from '@app/features/next-soup/soup-view/sort-options';
import { TOKENS } from '@core/hotkey/tokens';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import { Button, ButtonGroup, Dropdown, SingleSelectCheck } from '@ui';
import { type Component, For, Show } from 'solid-js';

interface SortDropdownProps {
  grouped?: boolean;
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
      <Dropdown.Trigger
        aria-label="Sort"
        tooltip={{ content: 'Sort', hotkey: TOKENS.soup.sort }}
        as={props.grouped ? ButtonGroup.Button : Button}
        variant="ghost"
        size={props.grouped ? 'icon-sm' : 'icon-md'}
      >
        <SortIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
      </Dropdown.Trigger>
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
