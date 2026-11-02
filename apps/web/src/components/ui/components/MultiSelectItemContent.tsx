import type { JSX } from 'solid-js';
import { Button } from './Button';
import { InlineCheckbox } from './Checkbox';

/** Shared affordances for menu and searchable multiselect rows. */
export function MultiSelectItemContent(props: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onOnly: () => void;
  onlyLabel?: 'Only' | 'All';
  children: JSX.Element;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        data-multiselect-checkbox
        class="-my-1.5 -ml-2 inline-flex self-stretch items-center pl-2 pr-1 touch:min-h-11 touch:min-w-9"
      >
        <InlineCheckbox checked={props.checked} />
      </span>
      {props.children}
      <Button
        variant="ghost"
        size="xs"
        tabIndex={-1}
        disabled={props.disabled}
        aria-label={
          props.onlyLabel === 'All'
            ? 'Select all'
            : `Select only ${props.label}`
        }
        class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none not-touch:group-hover:opacity-100 not-touch:group-hover:pointer-events-auto group-data-highlighted:opacity-100 group-data-highlighted:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto touch:opacity-100 touch:pointer-events-auto"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerUp={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          props.onOnly();
        }}
      >
        {props.onlyLabel ?? 'Only'}
      </Button>
    </>
  );
}
