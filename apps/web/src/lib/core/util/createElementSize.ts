import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  onCleanup,
} from 'solid-js';

export type ElementSize = {
  readonly width: number | null;
  readonly height: number | null;
};

/**
 * Untransformed border-box size for a horizontal-writing HTML element.
 * Unknown until ResizeObserver delivers; never reads layout during rendering.
 * The observed app containers use horizontal writing even when their children
 * contain vertical text. Consumers needing transformed bounds must measure
 * that geometry separately, outside reactive rendering.
 */
export function createElementSize(
  target: HTMLElement | Accessor<HTMLElement | false | null | undefined>
): ElementSize {
  const [width, setWidth] = createSignal<number | null>(null);
  const [height, setHeight] = createSignal<number | null>(null);
  let current: HTMLElement | false | null | undefined;
  const observer = new ResizeObserver((entries) => {
    batch(() => {
      for (const entry of entries) {
        if (entry.target !== current) continue;
        const size = entry.borderBoxSize[0];
        if (!size) continue;
        setWidth(size.inlineSize);
        setHeight(size.blockSize);
      }
    });
  });
  onCleanup(() => observer.disconnect());
  createEffect(() => {
    current = typeof target === 'function' ? target() : target;
    batch(() => {
      setWidth(null);
      setHeight(null);
    });
    if (!current) return;
    const element = current;
    observer.observe(element, { box: 'border-box' });
    onCleanup(() => observer.unobserve(element));
  });
  return {
    get width() {
      return width();
    },
    get height() {
      return height();
    },
  };
}
