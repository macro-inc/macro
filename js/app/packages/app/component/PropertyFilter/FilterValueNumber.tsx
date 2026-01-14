import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';

export type FilterValueNumberProps = {
  value: number | null;
  onChange: (value: number) => void;
};

export const FilterValueNumber: Component<FilterValueNumberProps> = (props) => {
  const [isEditing, setIsEditing] = createSignal(false);
  // Track local input value for controlled input
  const [inputValue, setInputValue] = createSignal(
    props.value !== null ? String(props.value) : ''
  );
  let inputRef!: HTMLInputElement;

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

  const handleFocus = () => {
    setIsEditing(true);
  };

  const handleBlur = () => {
    const parsed = parseFloat(inputValue());
    if (!isNaN(parsed)) {
      props.onChange(parsed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      const parsed = parseFloat(inputValue());
      if (!isNaN(parsed)) {
        props.onChange(parsed);
      }
    }
  };

  const handleClick = () => {
    setIsEditing(true);
    setTimeout(() => inputRef?.focus(), 0);
  };

  const displayValue = () => {
    if (props.value === null) return 'Value...';
    return String(props.value);
  };

  return (
    <Show
      when={isEditing()}
      fallback={
        <button
          type="button"
          onClick={handleClick}
          class="h-6 px-2 w-fit text-xxs border border-edge hover:bg-hover text-left font-mono flex items-center"
          classList={{
            'text-ink': props.value !== null,
            'text-ink-muted': props.value === null,
          }}
        >
          {displayValue()}
        </button>
      }
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={inputValue()}
        onInput={handleInput}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="Enter value..."
        class="h-6 px-2 min-w-8 w-fit text-xxs text-ink border border-edge hover:bg-hover focus:ring-1 focus:ring-accent font-mono placeholder:text-ink-muted"
      />
    </Show>
  );
};
