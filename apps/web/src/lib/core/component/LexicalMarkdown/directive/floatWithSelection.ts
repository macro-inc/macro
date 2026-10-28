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
  shift,
  size,
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
  /**
   * Stay on this range or element instead of following the live selection, for
   * UI that keeps its place after focus leaves the text it was opened on.
   */
  anchor?: Range | Element;
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

  async function roomOn(
    anchor: Range | Element,
    placement: Placement,
    spacing: number
  ) {
    let room = 0;
    await computePosition(anchor, floatingEl, {
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

  function anchorFrom(
    selection: Selection | null | undefined
  ): Range | Element | null {
    // A pinned anchor outlives the selection it was opened on.
    const pinned = accessor()?.anchor;
    if (pinned) return pinned;
    if (!selection) return null;
    if (selection.rangeCount >= 1) {
      // Snapshot the caret. getRangeAt() is live, so focusing a picker
      // search field would rewrite this anchor and hide() the menu.
      const range = selection.getRangeAt(0).cloneRange();
      return range.collapsed && range.startContainer instanceof Element
        ? range.startContainer
        : range;
    }
    return selection.anchorNode instanceof Element
      ? selection.anchorNode
      : null;
  }

  async function setInitialFloatingPosition(
    selection: Selection | null | undefined
  ) {
    const anchor = anchorFrom(selection);

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
      const { placement } = await computePosition(anchor, floatingEl, {
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
      });

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
      current,
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
