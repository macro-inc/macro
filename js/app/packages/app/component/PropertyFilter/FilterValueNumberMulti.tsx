import XIcon from '@phosphor-icons/core/assets/regular/x.svg';
import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';

export type FilterValueNumberMultiProps = {
  values: number[];
  onChange: (values: number[]) => void;
};

export const FilterValueNumberMulti: Component<FilterValueNumberMultiProps> = (
  props
) => {
  const [isAdding, setIsAdding] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
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
    target.value = sanitized;
  };

  const handleAddClick = () => {
    setIsAdding(true);
    setInputValue('');
    setTimeout(() => inputRef?.focus(), 0);
  };

  const handleConfirm = () => {
    const parsed = parseFloat(inputValue());
    if (!isNaN(parsed) && !props.values.includes(parsed)) {
      props.onChange([...props.values, parsed]);
    }
    setIsAdding(false);
    setInputValue('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      setIsAdding(false);
      setInputValue('');
    }
  };

  const handleRemoveValue = (value: number) => {
    props.onChange(props.values.filter((v) => v !== value));
  };

  return (
    <div class="flex flex-wrap items-center gap-0.5 min-w-0">
      {/* Selected value pills */}
      <For each={props.values}>
        {(value) => (
          <div class="group relative h-6 px-1.5 text-xxs text-ink border border-edge bg-surface font-mono flex items-center">
            <span class="whitespace-nowrap">{String(value)}</span>
            {/* X shows on hover, overlays the text */}
            <button
              type="button"
              onClick={() => handleRemoveValue(value)}
              class="absolute inset-0 flex items-center justify-end pr-1 bg-linear-to-l from-surface via-surface to-transparent opacity-0 group-hover:opacity-100 hover:text-failure-ink"
            >
              <XIcon class="size-3" />
            </button>
          </div>
        )}
      </For>

      {/* Add button / input */}
      <div class="relative flex items-center">
        <Show
          when={isAdding()}
          fallback={
            <button
              type="button"
              onClick={handleAddClick}
              class="h-6 px-2 text-xxs text-ink-muted border border-edge hover:bg-hover font-mono flex items-center"
            >
              {props.values.length === 0 ? 'Add value...' : '+'}
            </button>
          }
        >
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={inputValue()}
            onInput={handleInput}
            onBlur={handleConfirm}
            onKeyDown={handleKeyDown}
            placeholder="Enter value..."
            class="h-6 px-2 min-w-8 w-fit text-xxs text-ink border border-edge hover:bg-hover focus:ring-1 focus:ring-accent font-mono placeholder:text-ink-muted"
          />
        </Show>
      </div>
    </div>
  );
};
