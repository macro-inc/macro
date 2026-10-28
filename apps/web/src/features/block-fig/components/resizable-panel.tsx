/** A panel edge that resizes with the pointer or arrow keys. */
import type { JSX } from 'solid-js';

export function ResizablePanel(props: {
  side: 'left' | 'right';
  label: string;
  width: number;
  onResize: (width: number) => void;
  children: JSX.Element;
  onContextMenu?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>;
}) {
  const min = 224;
  const max = 420;
  const resize = (value: number) =>
    props.onResize(Math.min(max, Math.max(min, value)));
  let start: { x: number; width: number } | undefined;
  const direction = () => (props.side === 'left' ? 1 : -1);
  return (
    <aside
      class="relative flex shrink-0 flex-col border-edge-frame bg-page"
      classList={{
        'border-r': props.side === 'left',
        'border-l': props.side === 'right',
      }}
      style={{ width: `${props.width}px` }}
      aria-label={props.label}
      onContextMenu={props.onContextMenu}
    >
      {props.children}
      <div
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${props.label.toLowerCase()}`}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={props.width}
        data-testid={`fig-resize-${props.side}`}
        class="absolute inset-y-0 z-20 w-1 touch-none cursor-col-resize outline-none hover:bg-accent focus-visible:bg-accent"
        classList={{
          'right-0': props.side === 'left',
          'left-0': props.side === 'right',
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          start = { x: event.clientX, width: props.width };
        }}
        onPointerMove={(event) => {
          if (start)
            resize(start.width + (event.clientX - start.x) * direction());
        }}
        onPointerUp={() => {
          start = undefined;
        }}
        onPointerCancel={() => {
          start = undefined;
        }}
        onKeyDown={(event) => {
          if (
            event.key !== 'ArrowLeft' &&
            event.key !== 'ArrowRight' &&
            event.key !== 'Home' &&
            event.key !== 'End'
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Home') resize(min);
          else if (event.key === 'End') resize(max);
          else
            resize(
              props.width + (event.key === 'ArrowRight' ? 8 : -8) * direction()
            );
        }}
      />
    </aside>
  );
}
