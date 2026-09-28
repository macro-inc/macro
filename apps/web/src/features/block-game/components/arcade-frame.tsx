import type { JSX } from 'solid-js';

/** A pointer position in a board's field units. */
export function fieldPoint(
  event: PointerEvent | MouseEvent,
  element: Element,
  field: { width: number; height: number }
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  // Boards keep their aspect ratio, so any spare space is split evenly.
  const scale = Math.min(rect.width / field.width, rect.height / field.height);
  if (!Number.isFinite(scale) || scale <= 0) return { x: 0, y: 0 };
  const offsetX = (rect.width - field.width * scale) / 2;
  const offsetY = (rect.height - field.height * scale) / 2;
  return {
    x: (event.clientX - rect.left - offsetX) / scale,
    y: (event.clientY - rect.top - offsetY) / scale,
  };
}

/**
 * A focusable frame for real-time boards. Key presses are reported with
 * whether the game used them, so the page does not scroll on arrow keys.
 */
export function ArcadeFrame(props: {
  label: string;
  ref?: (element: HTMLDivElement) => void;
  onKeyDown?: (event: KeyboardEvent) => boolean;
  onKeyUp?: (event: KeyboardEvent) => void;
  onBlur?: () => void;
  onPointerDown?: (event: PointerEvent) => void;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerUp?: (event: PointerEvent) => void;
  onPointerCancel?: (event: PointerEvent) => void;
  children: JSX.Element;
}) {
  return (
    <div
      ref={props.ref}
      class="flex w-full touch-none justify-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
      tabindex={0}
      role="application"
      aria-label={props.label}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (props.onKeyDown?.(event)) event.preventDefault();
      }}
      onKeyUp={(event) => props.onKeyUp?.(event)}
      onBlur={() => props.onBlur?.()}
      onPointerDown={(event) => props.onPointerDown?.(event)}
      onPointerMove={(event) => props.onPointerMove?.(event)}
      onPointerUp={(event) => props.onPointerUp?.(event)}
      onPointerCancel={(event) => props.onPointerCancel?.(event)}
    >
      {props.children}
    </div>
  );
}
