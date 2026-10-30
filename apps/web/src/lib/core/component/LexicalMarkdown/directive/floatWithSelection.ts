import { isInBlock } from '@core/block';
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
  type ReferenceElement,
  shift,
  size,
  type VirtualElement,
} from '@floating-ui/dom';
import { Telemetry } from '@macro-inc/observability';
import type { Accessor, JSX } from 'solid-js';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { iosSafePadding, iosSizeMiddleware } from './iosFloatingMiddleware';

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
  onAvailableHeight?: (height: number) => void;
  /**
   * The menu's height with its whole list. It opens below the caret when that
   * height (or what it renders, if taller) fits there and above when there is
   * more room above: a list that renders short and then grows would otherwise
   * stay below the caret and shrink.
   */
  fullHeight?: number;
  /**
   * Anchor to the part of a range selection that is not clipped by a
   * scrolling ancestor. A selection that runs past the bottom of a
   * height-capped editor would otherwise place the menu below its hidden end.
   */
  clipToVisible?: boolean;
};

function intersectRects(a: DOMRect, b: DOMRect): DOMRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right < left || bottom < top) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function visibleRangeReference(range: Range): VirtualElement {
  const container = range.commonAncestorContainer;
  const contextElement =
    container instanceof Element ? container : container.parentElement;
  return {
    contextElement: contextElement ?? undefined,
    getBoundingClientRect() {
      const rect = range.getBoundingClientRect();
      let visible: DOMRect | null = rect;
      for (let el = contextElement; el && visible; el = el.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(el);
        if (overflowX !== 'visible' || overflowY !== 'visible') {
          visible = intersectRects(visible, el.getBoundingClientRect());
        }
      }
      if (visible) {
        visible = intersectRects(
          visible,
          new DOMRect(0, 0, window.innerWidth, window.innerHeight)
        );
      }
      // Fully clipped: keep the real rect so hide() can hide the menu.
      return visible ?? rect;
    },
  };
}

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

  function toReference(anchor: Range | Element): ReferenceElement {
    return accessor()?.clipToVisible && anchor instanceof Range
      ? visibleRangeReference(anchor)
      : anchor;
  }

  async function roomOn(
    anchor: Range | Element,
    placement: Placement,
    spacing: number
  ) {
    let room = 0;
    await computePosition(toReference(anchor), floatingEl, {
      placement,
      middleware: [
        offset(spacing),
        size({
          boundary,
          padding: iosSafePadding(spacing),
          apply: ({ availableHeight }) => {
            room = availableHeight;
          },
        }),
      ],
    });
    return room;
  }

  async function sideWithRoomFor(
    anchor: Range | Element,
    fullHeight: number,
    spacing: number
  ): Promise<Placement> {
    const height = Math.max(fullHeight, floatingEl.offsetHeight);
    const below = await roomOn(anchor, 'bottom-start', spacing);
    if (below >= height) return 'bottom-start';
    const above = await roomOn(anchor, 'top-start', spacing);
    return above > below ? 'top-start' : 'bottom-start';
  }

  async function setInitialFloatingPosition(
    selection: Selection | null | undefined
  ) {
    if (!selection) return;
    let anchor: Range | Element | null = null;

    if (selection.rangeCount >= 1) {
      // Snapshot the caret. getRangeAt() is live, so focusing a picker
      // search field would rewrite this anchor and hide() the menu.
      const range = selection.getRangeAt(0).cloneRange();
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
      const spacing = accessor()?.spacing ?? DEFAULT_SPACING;
      const fullHeight = accessor()?.fullHeight;
      if (fullHeight !== undefined) {
        decidedPlacement = await sideWithRoomFor(anchor, fullHeight, spacing);
        await updatePosition();
        return;
      }
      const floatingOptions = accessor()?.floatingOptions ?? {};
      const preferredPlacement = floatingOptions.placement ?? 'bottom-start';
      const { placement } = await computePosition(
        toReference(anchor),
        floatingEl,
        {
          placement: preferredPlacement,
          middleware: [
            flip({
              // Default menus sit below the caret and flip above. A caller that
              // asked for another side (e.g. `placement: 'top'`) should flip to
              // the opposite side instead of being stuck on `top-start`.
              ...(preferredPlacement === 'bottom-start'
                ? { fallbackPlacements: ['top-start'] as const }
                : {}),
              boundary,
              padding: iosSafePadding(spacing),
            }),
            offset(spacing),
            shift({ padding: spacing, boundary }),
            hide(),
          ],
          ...floatingOptions,
        }
      );

      decidedPlacement = placement;
      await updatePosition();
    }
  }

  async function updatePosition() {
    let current = currentAnchor();
    if (!current || !decidedPlacement) return;

    const spacing = accessor()?.spacing ?? DEFAULT_SPACING;
    const onAvailableHeight = accessor()?.onAvailableHeight;
    const { x, y, middlewareData } = await computePosition(
      toReference(current),
      floatingEl,
      {
        placement: decidedPlacement,
        middleware: [
          offset(spacing),
          shift({ padding: iosSafePadding(spacing), boundary }),
          ...(onAvailableHeight
            ? [iosSizeMiddleware(spacing, onAvailableHeight)]
            : []),
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

  const reportPositionError = (error: unknown) =>
    Telemetry.error(error, { surface: 'float-with-selection' });

  const placeInBackground = (selection: Selection | null | undefined) => {
    setInitialFloatingPosition(selection).catch(reportPositionError);
  };

  const repositionInBackground = () => {
    if (currentAnchor()) {
      updatePosition().catch(reportPositionError);
    }
  };

  const selectionChangeHandler = () => {
    let selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    setCurrentAnchor(selection.getRangeAt(0));
    placeInBackground(selection);
  };

  const scrollHandler = repositionInBackground;
  let scrollParent: Element | Document | null = null;

  const resizeObserver = new ResizeObserver(repositionInBackground);

  const mutationObserver = new MutationObserver(repositionInBackground);

  onMount(() => {
    placeInBackground(accessor()?.selection);

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
    cleanupAutoUpdate = autoUpdate(
      toReference(reference),
      floatingEl,
      updatePosition,
      {
        elementResize: true,
        ancestorScroll: true,
        ancestorResize: true,
      }
    );
  });

  onCleanup(() => {
    document.removeEventListener('selectionchange', selectionChangeHandler);
    scrollParent?.removeEventListener('scroll', scrollHandler);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    cleanupAutoUpdate();
  });
}
