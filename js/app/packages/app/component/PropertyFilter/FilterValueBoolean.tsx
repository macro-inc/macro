import type { Component } from 'solid-js';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

export type FilterValueBooleanProps = {
  value: boolean | null;
  onSelect: (value: boolean) => void;
};

export const FilterValueBoolean: Component<FilterValueBooleanProps> = (
  props
) => {
  const [isOpen, setIsOpen] = createSignal(false);

  let containerRef!: HTMLDivElement;
  let dropdownRef!: HTMLDivElement;

  const handleSelect = (value: boolean) => {
    props.onSelect(value);
    setIsOpen(false);
  };

  // Close dropdown when clicking outside
  const handleClickOutside = (event: MouseEvent) => {
    if (!isOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;

    const isInsideContainer = containerRef?.contains(target);
    const isInsideDropdown = dropdownRef?.contains(target);

    if (!isInsideContainer && !isInsideDropdown) {
      setIsOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() =>
      document.removeEventListener('mousedown', handleClickOutside)
    );
  });

  const displayValue = () => {
    if (props.value === null) return 'Select...';
    return props.value ? 'True' : 'False';
  };

  return (
    <div ref={containerRef} class="flex relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class="h-6 px-2 w-fit text-xxs border border-edge hover:bg-hover text-left font-mono flex items-center"
        classList={{
          'text-ink': props.value !== null,
          'text-ink-muted': props.value === null,
        }}
      >
        {displayValue()}
      </button>
      <Show when={isOpen()}>
        <div
          ref={dropdownRef}
          class="absolute left-0 top-full mt-1 border border-edge bg-surface shadow-lg font-mono min-w-20 z-user-highlight"
        >
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSelect(true);
            }}
            class="w-full px-2 py-1.5 text-xxs text-ink hover:bg-hover text-left"
            classList={{ 'bg-hover': props.value === true }}
          >
            True
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSelect(false);
            }}
            class="w-full px-2 py-1.5 text-xxs text-ink hover:bg-hover text-left"
            classList={{ 'bg-hover': props.value === false }}
          >
            False
          </button>
        </div>
      </Show>
    </div>
  );
};
