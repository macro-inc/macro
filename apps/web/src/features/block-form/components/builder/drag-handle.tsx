import DotsSixVertical from '@phosphor/dots-six-vertical.svg';
import { cn } from '@ui';
import type { JSX } from 'solid-js';

/** Instructions every handle points at, read once by assistive technology. */
export function DragInstructions(props: { id: string }) {
  return (
    <p id={props.id} class="sr-only">
      Press Space or Enter to pick up. Use the up and down arrow keys to move,
      Space or Enter to drop, Escape to cancel. The item’s menu also has Move
      up, Move down and Move to section.
    </p>
  );
}

/**
 * The grip a question or section is dragged by. It is the only place a drag
 * starts, so text fields in the card keep their own pointer behavior.
 */
export function DragHandle(props: {
  label: string;
  /** The builder's instructions, read by assistive technology. */
  instructionsId: string;
  dragging: boolean;
  disabled?: boolean;
  handle: {
    onPointerDown: (event: PointerEvent) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    onBlur: () => void;
  };
  ref?: (element: HTMLButtonElement) => void;
  class?: string;
  'data-drag-handle'?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      ref={props.ref}
      data-drag-handle={props['data-drag-handle']}
      aria-label={props.label}
      aria-describedby={props.instructionsId}
      aria-pressed={props.dragging}
      aria-roledescription="drag handle"
      disabled={props.disabled}
      class={cn(
        'flex size-7 shrink-0 touch-none items-center justify-center rounded-md text-ink-extra-muted outline-none transition-colors',
        'hover:bg-hover hover:text-ink-muted focus-visible:ring-2 focus-visible:ring-edge-focus',
        'disabled:pointer-events-none disabled:opacity-40',
        props.dragging ? 'cursor-grabbing bg-active text-ink' : 'cursor-grab',
        props.class
      )}
      onPointerDown={props.handle.onPointerDown}
      onKeyDown={props.handle.onKeyDown}
      onBlur={props.handle.onBlur}
    >
      <DotsSixVertical class="size-4" />
    </button>
  );
}
