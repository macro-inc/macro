import { DatePicker } from '@core/component/DatePicker';
import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';

export type FilterValueDateProps = {
  value: string | null; // ISO date string or null
  onChange: (value: string) => void;
};

export const FilterValueDate: Component<FilterValueDateProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  let buttonRef!: HTMLButtonElement;

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

  const dateValue = () => {
    if (!props.value) return new Date();
    return parseLocalDate(props.value);
  };

  const displayValue = () => {
    if (!props.value) return 'Select date...';
    const date = parseLocalDate(props.value);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleDateChange = (date: Date) => {
    props.onChange(formatLocalDate(date));
    setIsOpen(false);
  };

  return (
    <div class="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(true)}
        class="h-6 px-2 w-fit text-[10px] border border-edge hover:bg-hover text-left font-mono flex items-center"
        classList={{
          'text-ink': props.value !== null,
          'text-ink-muted': props.value === null,
        }}
      >
        {displayValue()}
      </button>
      <Show when={isOpen()}>
        <DatePicker
          value={dateValue()}
          onChange={handleDateChange}
          onClose={() => setIsOpen(false)}
          anchorRef={buttonRef}
        />
      </Show>
    </div>
  );
};
