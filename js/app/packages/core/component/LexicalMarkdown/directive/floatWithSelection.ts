import { isInBlock } from '@core/block';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { blockElementSignal } from '@core/signal/blockElement';
import { getScrollParent } from '@core/util/scrollParent';
import {
  autoUpdate,
  type Boundary,
  type ComputePositionConfig,
  computePosition,
  flip,
  hide,
  offset,
  type Placement,
  shift,
} from '@floating-ui/dom';
import type { Accessor, JSX } from 'solid-js';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

const DEFAULT_SPACING = 8;

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      floatWithSelection: FloatWithSelectionOptions | undefined;
    }
  }
}

function style(el: HTMLElement, styles: Partial<JSX.CSSProperties>) {
  Object.assign(el.style, styles);
}

type FloatWithSelectionOptions = {
  selection: Selection | undefined | null;
  reactiveOnContainer?: HTMLElement | null;
  useBlockBoundary?: boolean;
  spacing?: number;
  floatingOptions?: Partial<ComputePositionConfig>;
  moveWithSelection?: boolean;
};

export function floatWithSelection(
  floatingEl: HTMLElement,
  accessor: Accessor<FloatWithSelectionOptions | undefined>
) {
  style(floatingEl, { position: 'fixed' });
  let cleanupAutoUpdate: () => void = () => {};

  let boundary: Boundary = 'clippingAncestors';
  if (accessor()?.useBlockBoundary && isInBlock()) {
    const blockElement = blockElementSignal.get;
    boundary = blockElement() ?? 'clippingAncestors';
  }

  let [currentAnchor, setCurrentAnchor] = createSignal<Range | Element | null>(
    null
  );
  let decidedPlacement: Placement | null = null;

  async function setInitialFloatingPosition(
    selection: Selection | null | undefined
  ) {
    if (!selection) return;
    let anchor: Range | Element | null = null;

    if (selection.rangeCount >= 1) {
      const range = selection.getRangeAt(0);
      if (range.collapsed && range.startContainer instanceof Text) {
        anchor = range;
      } else if (range.collapsed && range.startContainer instanceof Element) {
        anchor = range.startContainer;
      } else {
        anchor = range;
      }
    } else if (selection.anchorNode instanceof Element) {
      anchor = selection.anchorNode;
    }

    if (anchor) {
      setCurrentAnchor(anchor);
      const { placement } = await computePosition(anchor, floatingEl, {
        placement: isTouchDevice ? 'top-start' : 'bottom-start',
        middleware: [
          isTouchDevice
            ? null
            : flip({
                fallbackStrategy: 'initialPlacement',
                fallbackPlacements: ['top-start'],
                boundary,
                padding: accessor()?.spacing ?? DEFAULT_SPACING,
              }),
          offset(accessor()?.spacing ?? DEFAULT_SPACING),
          shift({ padding: accessor()?.spacing ?? DEFAULT_SPACING, boundary }),
          hide(),
        ],
      });

      decidedPlacement = placement;
      await updatePosition();
    }
  }

  async function updatePosition() {
    let current = currentAnchor();
    if (!current || !decidedPlacement) return;

    const { x, y, middlewareData } = await computePosition(
      current,
      floatingEl,
      {
        placement: decidedPlacement,
        middleware: [
          offset(accessor()?.spacing ?? DEFAULT_SPACING),
          shift({ padding: accessor()?.spacing ?? DEFAULT_SPACING, boundary }),
          hide(),
        ],
      }
    );

    style(floatingEl, {
      left: `${x}px`,
      top: `${y}px`,
      visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
    });
  }

  const selectionChangeHandler = () => {
    let selection = document.getSelection();
    let range = selection?.getRangeAt(0);
    if (!range) return;
    setCurrentAnchor(range);
    setInitialFloatingPosition(selection);
  };

  const scrollHandler = () => {
    if (currentAnchor()) {
      updatePosition();
    }
  };
  let scrollParent: Element | Document | null = null;

  const resizeObserver = new ResizeObserver(() => {
    if (currentAnchor()) {
      updatePosition();
    }
  });

  const mutationObserver = new MutationObserver(() => {
    if (currentAnchor()) {
      updatePosition();
    }
  });

  onMount(() => {
    setInitialFloatingPosition(accessor()?.selection);

    if (accessor()?.moveWithSelection) {
      document.addEventListener('selectionchange', selectionChangeHandler);
    }

    resizeObserver.observe(floatingEl);
    mutationObserver.observe(floatingEl, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });

    let reactiveOnContainer = accessor()?.reactiveOnContainer;

    if (reactiveOnContainer) {
      scrollParent = getScrollParent(reactiveOnContainer);
      scrollParent?.addEventListener('scroll', scrollHandler);
      resizeObserver.observe(reactiveOnContainer);
      mutationObserver.observe(reactiveOnContainer, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
    }
  });

  createEffect(() => {
    cleanupAutoUpdate();
    const reference = currentAnchor();
    if (!reference) {
      console.log('No reference for autoUpdate');
      return;
    }
    cleanupAutoUpdate = autoUpdate(reference, floatingEl, updatePosition, {
      elementResize: true,
      ancestorScroll: true,
      ancestorResize: true,
    });
  });

  onCleanup(() => {
    document.removeEventListener('selectionchange', selectionChangeHandler);
    scrollParent?.removeEventListener('scroll', scrollHandler);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    cleanupAutoUpdate();
  });
}
