import SearchIcon from '@icon/regular/magnifying-glass.svg';
import type { Component, JSX } from 'solid-js';

type DropdownSearchInputProps = {
  value: string;
  placeholder: string;
  onInput: (value: string) => void;
  onKeyDown?: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent>;
  inputType?: string;
  inputRef?: (element: HTMLInputElement) => void;
};

export const DropdownSearchInput: Component<DropdownSearchInputProps> = (
  props
) => {
  return (
    <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
      <SearchIcon class="h-4 w-4 text-ink-muted" />
      <input
        class="w-full caret-accent"
        ref={props.inputRef}
        type={props.inputType ?? 'text'}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={props.onKeyDown}
        placeholder={props.placeholder}
      />
    </div>
  );
};
