import { type Component, For, type JSX, Show } from 'solid-js';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import CheckIcon from '@icon/regular/check.svg';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import ClockIcon from '@icon/regular/clock.svg';
import PencilIcon from '@icon/regular/pencil.svg';
import EyeIcon from '@icon/regular/eye.svg';
import type { SystemSortOption } from '@app/component/next-soup/soup-view/sort-options';

export interface SortOption {
  value: SystemSortOption;
  label: string;
  icon?: () => JSX.Element;
}

export const SORT_OPTIONS: SortOption[] = [
  {
    value: 'viewed_at',
    label: 'Last viewed',
    icon: () => <EyeIcon class="size-3.5" />,
  },
  {
    value: 'updated_at',
    label: 'Last modified',
    icon: () => <PencilIcon class="size-3.5" />,
  },
  {
    value: 'created_at',
    label: 'Date created',
    icon: () => <ClockIcon class="size-3.5" />,
  },
];

export interface SortDropdownProps {
  /** Current sort value */
  value: () => SystemSortOption;
  /** Handler for sort change */
  onChange: (value: SystemSortOption) => void;
  /** Available sort options (defaults to SORT_OPTIONS) */
  options?: SortOption[];
  /** Controlled open state (optional - uses internal state if not provided) */
  open?: boolean;
  /** Controlled open state setter (optional - uses internal state if not provided) */
  onOpenChange?: (open: boolean) => void;
}

export const SortDropdown: Component<SortDropdownProps> = (props) => {
  const options = () => props.options ?? SORT_OPTIONS;

  const currentOption = () => options().find((o) => o.value === props.value());

  const currentLabel = () => currentOption()?.label ?? 'Sort';

  return (
    <DropdownMenu
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-start"
      gutter={4}
    >
      <DropdownMenu.Trigger class="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md bg-ink/8 text-ink-muted hover:bg-ink/12 hover:text-ink transition-all">
        <Show when={currentOption()?.icon}>
          {(icon) => (
            <span class="size-3.5 flex items-center justify-center shrink-0">
              {icon()()}
            </span>
          )}
        </Show>
        <span class="font-medium">{currentLabel()}</span>
        <ChevronDownIcon class="size-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded shadow-xl min-w-[140px]">
          <For each={options()}>
            {(option) => (
              <DropdownMenu.Item
                class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-ink/5 focus:bg-ink/5 outline-none cursor-default"
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
