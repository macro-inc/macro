import type { Component } from 'solid-js';
import { createSignal } from 'solid-js';

export type FilterValueNumberProps = {
  value: number | null;
  onChange: (value: number) => void;
};

export const FilterValueNumber: Component<FilterValueNumberProps> = (props) => {
  // Track local input value for controlled input
  const [inputValue, setInputValue] = createSignal(
    props.value !== null ? String(props.value) : ''
  );

  const handleInput = (e: InputEvent) => {
    const target = e.currentTarget as HTMLInputElement;
    // Only allow digits, decimal point, and minus sign
    const filtered = target.value.replace(/[^0-9.\-]/g, '');
    // Prevent multiple decimals or minus signs
    const parts = filtered.split('.');
    const sanitized =
      parts.length > 2
        ? parts[0] + '.' + parts.slice(1).join('')
        : filtered.replace(/(?!^)-/g, ''); // Only allow minus at start
    setInputValue(sanitized);
    target.value = sanitized; // Update DOM to match filtered value
  };

  const handleBlur = () => {
    const parsed = parseFloat(inputValue());
    if (!isNaN(parsed)) {
      props.onChange(parsed);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      const parsed = parseFloat(inputValue());
      if (!isNaN(parsed)) {
        props.onChange(parsed);
      }
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={inputValue()}
      onInput={handleInput}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="0"
      class="h-6 px-2 min-w-16 w-fit text-[10px] text-ink border border-edge hover:bg-hover focus:ring-1 focus:ring-accent font-mono placeholder:text-ink-muted"
    />
  );
};
