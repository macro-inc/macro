import { type Component, createSignal, For, Show } from 'solid-js';
import { Popover } from '@kobalte/core/popover';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import SortIcon from '@macro-icons/wide/sort.svg';
import type { SystemSortOption } from '../../ViewConfig';
import { ShortcutLabel } from './FilterButton';

export interface SortOption {
  value: SystemSortOption;
  label: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { value: 'viewed_at', label: 'Viewed' },
  { value: 'updated_at', label: 'Updated' },
  { value: 'created_at', label: 'Created' },
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
      <Tooltip tooltip={<LabelAndHotKey label="Sort" shortcut="s" />}>
        <Popover.Trigger
          as="button"
          type="button"
          class="flex items-center gap-1.5 h-[22px] px-2.5 shrink-0 rounded-full active:bg-accent active:text-panel"
          classList={{
            'bg-accent text-panel': open(),
            'text-ink-muted hover:text-accent hover:bg-accent/20': !open(),
          }}
        >
          <SortIcon class="size-3.5" />
          <span class="text-xs leading-none">
            <ShortcutLabel label="Sort" shortcut="s" />
          </span>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          class="z-50 bg-panel border border-edge-muted shadow-lg"
          tabIndex={0}
          ref={(el) => setTimeout(() => el?.focus(), 0)}
          onKeyDown={handleKeyDown}
        >
          <div class="flex flex-col gap-1 p-2 min-w-[140px]">
            <For each={options()}>
              {(option, index) => (
                <button
                  type="button"
                  class="flex items-center justify-between px-2 py-1.5 text-sm hover:bg-hover"
                  classList={{
                    'bg-hover text-ink': props.value() === option.value,
                    'text-ink': props.value() !== option.value,
                    'bg-hover': focusedIndex() === index(),
                  }}
                  onClick={() => {
                    props.onChange(option.value);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setFocusedIndex(index())}
                >
                  <span>{option.label}</span>
                  <Show when={props.value() === option.value}>
                    <span class="text-ink">✓</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
};
