import { DatePicker } from '@core/component/DatePicker';
import XIcon from '@phosphor-icons/core/assets/regular/x.svg';
import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';

export type FilterValueDateMultiProps = {
  values: string[]; // Array of ISO date strings
  onChange: (values: string[]) => void;
};

export const FilterValueDateMulti: Component<FilterValueDateMultiProps> = (
  props
) => {
  const [isPickerOpen, setIsPickerOpen] = createSignal(false);
  let addButtonRef!: HTMLButtonElement;

  // Parse YYYY-MM-DD as local date (not UTC)
  const parseLocalDate = (dateStr: string): Date => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  // Format Date as YYYY-MM-DD using local date components (not UTC)
  const formatLocalDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Format for display (shorter)
  const formatDisplayDate = (dateStr: string): string => {
    const date = parseLocalDate(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleAddDate = (date: Date) => {
    const dateStr = formatLocalDate(date);
    // Don't add duplicates
    if (!props.values.includes(dateStr)) {
      props.onChange([...props.values, dateStr]);
    }
    setIsPickerOpen(false);
  };

  const handleRemoveDate = (dateStr: string) => {
    props.onChange(props.values.filter((d) => d !== dateStr));
  };

  return (
    <div class="flex flex-wrap items-center gap-0.5 min-w-0">
      {/* Selected date pills */}
      <For each={props.values}>
        {(dateStr) => (
          <div class="group relative h-6 px-1.5 text-[10px] text-ink border border-edge bg-panel font-mono flex items-center">
            <span class="whitespace-nowrap">{formatDisplayDate(dateStr)}</span>
            {/* X shows on hover, overlays the text */}
            <button
              type="button"
              onClick={() => handleRemoveDate(dateStr)}
              class="absolute inset-0 flex items-center justify-end pr-1 bg-gradient-to-l from-panel via-panel to-transparent opacity-0 group-hover:opacity-100 hover:text-failure-ink"
            >
              <XIcon class="size-3" />
            </button>
          </div>
        )}
      </For>

      {/* Add button */}
      <div class="relative">
        <button
          ref={addButtonRef}
          type="button"
          onClick={() => setIsPickerOpen(true)}
          class="h-6 px-2 text-[10px] text-ink-muted border border-edge hover:bg-hover font-mono flex items-center"
        >
          {props.values.length === 0 ? 'Add date...' : '+'}
        </button>
        <Show when={isPickerOpen()}>
          <DatePicker
            value={new Date()}
            onChange={handleAddDate}
            onClose={() => setIsPickerOpen(false)}
            anchorRef={addButtonRef}
          />
        </Show>
      </div>
    </div>
  );
};
