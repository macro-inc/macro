import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Popover } from '@kobalte/core/popover';
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
  open?: () => boolean;
  /** Controlled open state setter (optional - uses internal state if not provided) */
  onOpenChange?: (open: boolean) => void;
}

export const SortDropdown: Component<SortDropdownProps> = (props) => {
  // Internal state for uncontrolled mode
  const [internalOpen, setInternalOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(0);

  // Use controlled or uncontrolled state
  const open = () => props.open?.() ?? internalOpen();
  const setOpen = (isOpen: boolean) => {
    if (props.onOpenChange) {
      props.onOpenChange(isOpen);
    } else {
      setInternalOpen(isOpen);
    }
  };

  const options = () => props.options ?? SORT_OPTIONS;

  const currentOption = () => options().find((o) => o.value === props.value());

  const currentLabel = () => currentOption()?.label ?? 'Sort';

  const handleKeyDown = (e: KeyboardEvent) => {
    const totalItems = options().length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      props.onChange(options()[focusedIndex()].value);
      setOpen(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (isOpen) setFocusedIndex(0);
      }}
      placement="bottom-start"
      gutter={4}
    >
      <Popover.Trigger
        as="button"
        type="button"
        class="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md bg-ink/8 text-ink-muted hover:bg-ink/12 hover:text-ink transition-all"
      >
        <Show when={currentOption()?.icon}>
          {(icon) => (
            <span class="size-3.5 flex items-center justify-center shrink-0">
              {icon()()}
            </span>
          )}
        </Show>
        <span class="font-medium">{currentLabel()}</span>
        <ChevronDownIcon class="size-3" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="z-action-menu bg-surface-0 border border-edge-muted rounded shadow-xl min-w-[120px]"
          tabIndex={0}
          ref={(el) => setTimeout(() => el?.focus(), 0)}
          onKeyDown={handleKeyDown}
        >
          <div class="flex flex-col py-1">
            <For each={options()}>
              {(option, index) => (
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-ink/5 group"
                  classList={{
                    'bg-ink/5': focusedIndex() === index(),
                  }}
                  onClick={() => {
                    props.onChange(option.value);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setFocusedIndex(index())}
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
                </button>
              )}
            </For>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
};
