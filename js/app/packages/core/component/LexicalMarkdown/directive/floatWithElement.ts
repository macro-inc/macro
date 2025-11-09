import { isInBlock } from '@core/block';
import { blockElementSignal } from '@core/signal/blockElement';
import {
  autoUpdate,
  type Boundary,
  type ComputePositionConfig,
  computePosition,
  flip,
  hide,
  offset,
  shift,
} from '@floating-ui/dom';
import type { Accessor, JSX } from 'solid-js';
import { createEffect, onCleanup } from 'solid-js';

export type FloatWithElementOptions = {
  element: () => Element | undefined | null;
  spacing?: number;
  useBlockBoundary?: boolean;
  floatingOptions?: Partial<ComputePositionConfig>;
};

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      floatWithElement: FloatWithElementOptions | undefined;
    }
  }
}

function style(el: HTMLElement, styles: Partial<JSX.CSSProperties>) {
  Object.assign(el.style, styles);
}

/**
 * Floats an element anchored to another element that moves dynamically.
 */
export function floatWithElement(
  floatingEl: HTMLElement,
  accessor: Accessor<FloatWithElementOptions | undefined>
) {
  style(floatingEl, { position: 'absolute' });
  let referenceEl: Element | null;
  let cleanup: () => void = () => {};

  let boundary: Boundary = 'clippingAncestors';
  if (accessor()?.useBlockBoundary && isInBlock()) {
    const blockElement = blockElementSignal.get;
    boundary = blockElement() ?? 'clippingAncestors';
  }

  async function updatePosition() {
    if (!referenceEl) {
      style(floatingEl, { display: 'none' });
      return;
    }

    const { x, y, middlewareData } = await computePosition(
      referenceEl,
      floatingEl,
      {
        placement: 'bottom-start',
        middleware: [
          offset(accessor()?.spacing ?? 8),
          flip(),
          shift({ padding: accessor()?.spacing ?? 8, boundary }),
          hide(),
        ],
        ...(accessor()?.floatingOptions ?? {}),
      }
    );

    style(floatingEl, {
      left: `${x}px`,
      top: `${y}px`,
      visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
    });
  }

  createEffect(() => {
    cleanup();
    referenceEl = accessor()?.element() ?? null;
    if (!referenceEl) return;

    cleanup = autoUpdate(referenceEl, floatingEl, updatePosition);
  });

  onCleanup(() => {
    cleanup();
  });
}
