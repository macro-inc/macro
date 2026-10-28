import { createSignal, type JSX, Show } from 'solid-js';

/** The document owns the saved height; dragging previews locally until release. */
export function ResizableAnswer(props: {
  height?: number;
  onResize?: (height: number) => void;
  children: JSX.Element;
}) {
  let viewport!: HTMLDivElement;
  let drag: { pointer: number; y: number; height: number } | undefined;
  const [preview, setPreview] = createSignal<number>();
  const height = () => preview() ?? props.height;
  const clamp = (value: number) =>
    Math.round(Math.max(96, Math.min(1600, value)));
  const finish = (event: PointerEvent, cancelled = false) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag = undefined;
    const next = preview();
    if (!cancelled && next !== undefined) props.onResize?.(next);
    setPreview();
  };
  return (
    <>
      <div
        ref={viewport}
        data-answer-viewport
        class="overflow-auto p-3"
        style={{
          height: height() === undefined ? undefined : `${height()}px`,
          'max-height': height() === undefined ? '320px' : undefined,
        }}
      >
        {props.children}
      </div>
      <Show when={props.onResize}>
        <button
          type="button"
          role="separator"
          aria-label="Resize database answer"
          aria-orientation="horizontal"
          aria-valuemin={96}
          aria-valuemax={1600}
          aria-valuenow={height() ?? 320}
          class="flex h-3 w-full touch-none cursor-row-resize items-center justify-center border-t border-edge-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge-focus"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            drag = {
              pointer: event.pointerId,
              y: event.clientY,
              height: viewport.getBoundingClientRect().height,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag || event.pointerId !== drag.pointer) return;
            setPreview(clamp(drag.height + event.clientY - drag.y));
          }}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={(event) => finish(event, true)}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            event.stopPropagation();
            props.onResize?.(
              clamp(
                viewport.getBoundingClientRect().height +
                  (event.key === 'ArrowDown' ? 40 : -40)
              )
            );
          }}
        >
          <span class="h-0.5 w-8 rounded bg-edge-muted" />
        </button>
      </Show>
    </>
  );
}
