import { type Accessor, For, type JSX, onCleanup, onMount } from 'solid-js';

export type InfiniteCarouselHandle = {
  beginExternalDrag: () => void;
  cancelPeek: () => void;
  dragExternal: (pointerDelta: number) => void;
  endExternalDrag: () => void;
  peekNext: () => void;
  select: (index: number) => void;
};

const SWIPE_CUE_DURATION = 1_600;
const SWIPE_CUE_PEEK_POINT = 0.54;

// Matches the cubic-bezier curve used by the hand cue. Solve x(t) before
// sampling y(t), since a CSS cubic-bezier's input is its x coordinate.
function swipeCueEase(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  const sample = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  const slope = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b);
  let t = p;

  for (let i = 0; i < 5; i += 1) {
    const derivative = slope(t, 0.22, 0.28);
    if (Math.abs(derivative) < 0.001) break;
    t = Math.min(1, Math.max(0, t - (sample(t, 0.22, 0.28) - p) / derivative));
  }

  return sample(t, 0.8, 1);
}

type CarouselItemContext = {
  isClone: Accessor<boolean>;
  logicalIndex: Accessor<number>;
  physicalIndex: Accessor<number>;
};

type InfiniteCarouselProps<T> = {
  ariaLabel: string;
  children: (item: T, context: CarouselItemContext) => JSX.Element;
  class?: string;
  items: readonly T[];
  onActiveChange?: (index: number) => void;
  onReady?: (handle: InfiniteCarouselHandle) => void;
  onSlideVisibilityChange?: (visibility: number[]) => void;
  style?: JSX.CSSProperties;
  trackProps?: {
    onPointerCancel?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
    onPointerDown?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
    onPointerMove?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
    onPointerUp?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
    onWheel?: JSX.EventHandler<HTMLDivElement, WheelEvent>;
    onScroll?: JSX.EventHandler<HTMLDivElement, Event>;
  };
};

/**
 * A touch-first, looping carousel with three repeated slide sets. Consumers
 * own the slide markup and controls; this component owns centering, invisible
 * recentering, and active-slide tracking.
 */
export function InfiniteCarousel<T>(props: InfiniteCarouselProps<T>) {
  const loops = () => props.items.length > 1;
  const carouselItems = () =>
    loops() ? [...props.items, ...props.items, ...props.items] : props.items;

  let track: HTMLDivElement | undefined;
  let peekFrame: number | undefined;
  let peekStartingOffset: number | undefined;
  let recenterTimer: ReturnType<typeof setTimeout> | undefined;
  let restorePeekStyles: (() => void) | undefined;
  let pointerActive = false;
  let externalDragActive = false;
  let externalDragStartingOffset: number | undefined;
  let restoreExternalDragStyles: (() => void) | undefined;

  const logicalIndex = (physicalIndex: number) => {
    if (!loops()) return physicalIndex;
    return physicalIndex % props.items.length;
  };

  const getSlideElements = () =>
    track ? (Array.from(track.children) as HTMLElement[]) : [];

  const centeredScrollOffset = (slide: HTMLElement) =>
    Math.max(
      0,
      slide.offsetLeft + slide.offsetWidth / 2 - (track?.clientWidth ?? 0) / 2
    );

  const syncCarousel = () => {
    if (!track) return undefined;

    const slideElements = getSlideElements();
    if (slideElements.length === 0) return undefined;

    const viewportCenter = track.scrollLeft + track.clientWidth / 2;
    const nearestSlide = slideElements.reduce(
      (nearestIndex, slide, index, allSlides) => {
        const nearest = allSlides[nearestIndex];
        const nearestDistance = Math.abs(
          nearest.offsetLeft + nearest.offsetWidth / 2 - viewportCenter
        );
        const currentDistance = Math.abs(
          slide.offsetLeft + slide.offsetWidth / 2 - viewportCenter
        );

        return currentDistance < nearestDistance ? index : nearestIndex;
      },
      0
    );

    props.onActiveChange?.(logicalIndex(nearestSlide));
    props.onSlideVisibilityChange?.(
      slideElements.map((slide) =>
        Math.max(
          0,
          1 -
            Math.abs(
              slide.offsetLeft + slide.offsetWidth / 2 - viewportCenter
            ) /
              (track.clientWidth * 0.48)
        )
      )
    );

    return nearestSlide;
  };

  const recenterCarousel = () => {
    if (!track || !loops() || pointerActive || externalDragActive) return;

    const nearestSlide = syncCarousel();
    if (nearestSlide === undefined) return;

    const slideElements = getSlideElements();
    const setLength = props.items.length;
    const matchingSlide =
      nearestSlide < setLength
        ? slideElements[nearestSlide + setLength]
        : nearestSlide >= setLength * 2
          ? slideElements[nearestSlide - setLength]
          : undefined;
    if (!matchingSlide) return;

    // Keep the exact in-progress offset while moving back to the center set.
    // This gives touch momentum another full set of slides instead of hitting
    // a clone at the physical edge and waiting for a delayed reset.
    const currentSlide = slideElements[nearestSlide];
    const priorScrollBehavior = track.style.scrollBehavior;
    track.style.scrollBehavior = 'auto';
    track.scrollLeft += matchingSlide.offsetLeft - currentSlide.offsetLeft;
    track.style.scrollBehavior = priorScrollBehavior;
    syncCarousel();
  };

  const scheduleRecentering = () => {
    if (recenterTimer) clearTimeout(recenterTimer);
    if (pointerActive || externalDragActive) return;
    // The repeated sets leave a full buffer on both sides. Wait until native
    // scrolling and snap settling finish before moving the equivalent card
    // back to the middle set, so slow drags never visibly jump.
    recenterTimer = setTimeout(recenterCarousel, 180);
  };

  const select = (index: number) => {
    if (!track) return;

    const viewportCenter = track.scrollLeft + track.clientWidth / 2;
    const targetSlide = getSlideElements()
      .filter((_, physicalIndex) => logicalIndex(physicalIndex) === index)
      .reduce(
        (nearest, slide) => {
          if (!nearest) return slide;
          const nearestDistance = Math.abs(
            nearest.offsetLeft + nearest.offsetWidth / 2 - viewportCenter
          );
          const currentDistance = Math.abs(
            slide.offsetLeft + slide.offsetWidth / 2 - viewportCenter
          );
          return currentDistance < nearestDistance ? slide : nearest;
        },
        undefined as HTMLElement | undefined
      );

    if (targetSlide)
      track.scrollTo({
        left: centeredScrollOffset(targetSlide),
        behavior: 'smooth',
      });
  };

  // Controls outside the scroll viewport can call these methods to mirror a
  // direct drag: move the same track live, then restore its native snapping.
  const beginExternalDrag = () => {
    if (!track || externalDragActive) return;

    cancelPeek();
    externalDragActive = true;
    externalDragStartingOffset = track.scrollLeft;
    if (recenterTimer) clearTimeout(recenterTimer);

    const priorScrollBehavior = track.style.scrollBehavior;
    const priorScrollSnapType = track.style.scrollSnapType;
    track.style.scrollBehavior = 'auto';
    track.style.scrollSnapType = 'none';
    restoreExternalDragStyles = () => {
      if (!track) return;
      track.style.scrollBehavior = priorScrollBehavior;
      track.style.scrollSnapType = priorScrollSnapType;
      restoreExternalDragStyles = undefined;
    };
  };

  const dragExternal = (pointerDelta: number) => {
    if (
      !track ||
      !externalDragActive ||
      externalDragStartingOffset === undefined
    )
      return;
    track.scrollLeft = externalDragStartingOffset - pointerDelta;
    syncCarousel();
  };

  const endExternalDrag = () => {
    if (!externalDragActive) return;
    restoreExternalDragStyles?.();
    externalDragActive = false;
    externalDragStartingOffset = undefined;
    scheduleRecentering();
  };

  const cancelPeek = () => {
    if (peekFrame !== undefined) cancelAnimationFrame(peekFrame);
    peekFrame = undefined;
    if (track && peekStartingOffset !== undefined) {
      // Return to a snapped, settled position before handing control back to a
      // real swipe. This avoids leaving the user on the helper's midpoint.
      track.scrollLeft = peekStartingOffset;
    }
    restorePeekStyles?.();
    peekStartingOffset = undefined;
    syncCarousel();
  };

  const peekNext = () => {
    if (!track) return;

    cancelPeek();
    const startingOffset = track.scrollLeft;
    peekStartingOffset = startingOffset;
    const priorScrollSnapType = track.style.scrollSnapType;
    const priorScrollBehavior = track.style.scrollBehavior;
    // Mandatory snapping rejects a partial stop and immediately selects the
    // current slide. A shared rAF timeline gives the scroll and hand the same
    // duration and cubic-bezier easing, rather than relying on native smooth
    // scrolling whose timing differs by browser.
    track.style.scrollSnapType = 'none';
    track.style.scrollBehavior = 'auto';
    restorePeekStyles = () => {
      if (!track) return;
      track.style.scrollSnapType = priorScrollSnapType;
      track.style.scrollBehavior = priorScrollBehavior;
      restorePeekStyles = undefined;
    };

    const startTime = performance.now();
    const distance = track.clientWidth * 0.1;
    const animate = (now: number) => {
      if (!track) return;

      const progress = Math.min(1, (now - startTime) / SWIPE_CUE_DURATION);
      const phase =
        progress <= SWIPE_CUE_PEEK_POINT
          ? swipeCueEase(progress / SWIPE_CUE_PEEK_POINT)
          : 1 -
            swipeCueEase(
              (progress - SWIPE_CUE_PEEK_POINT) / (1 - SWIPE_CUE_PEEK_POINT)
            );
      track.scrollLeft = startingOffset + distance * phase;

      if (progress < 1) {
        peekFrame = requestAnimationFrame(animate);
      } else {
        peekFrame = undefined;
        track.scrollLeft = startingOffset;
        restorePeekStyles?.();
        peekStartingOffset = undefined;
        syncCarousel();
      }
    };

    peekFrame = requestAnimationFrame(animate);
  };

  props.onReady?.({
    beginExternalDrag,
    cancelPeek,
    dragExternal,
    endExternalDrag,
    peekNext,
    select,
  });

  onMount(() => {
    const initialSlide = getSlideElements()[loops() ? props.items.length : 0];
    if (!track || !initialSlide) return;

    // Initializing an infinite carousel means jumping from the first rendered
    // clone to the matching slide in the middle set. Do not inherit the
    // consumer's smooth scrolling here, or the page visibly races through
    // every intervening slide on first load.
    const priorScrollBehavior = track.style.scrollBehavior;
    track.style.scrollBehavior = 'auto';
    track.scrollLeft = centeredScrollOffset(initialSlide);
    track.style.scrollBehavior = priorScrollBehavior;
    syncCarousel();
  });

  onCleanup(() => {
    cancelPeek();
    endExternalDrag();
    if (recenterTimer) clearTimeout(recenterTimer);
  });

  return (
    <div
      ref={track}
      aria-label={props.ariaLabel}
      class={props.class}
      onPointerCancel={(event) => {
        pointerActive = false;
        props.trackProps?.onPointerCancel?.(event);
        scheduleRecentering();
      }}
      onPointerDown={(event) => {
        pointerActive = true;
        if (recenterTimer) clearTimeout(recenterTimer);
        props.trackProps?.onPointerDown?.(event);
      }}
      onPointerMove={props.trackProps?.onPointerMove}
      onPointerUp={(event) => {
        pointerActive = false;
        props.trackProps?.onPointerUp?.(event);
        scheduleRecentering();
      }}
      onWheel={props.trackProps?.onWheel}
      onScroll={(event) => {
        syncCarousel();
        scheduleRecentering();
        props.trackProps?.onScroll?.(event);
      }}
      style={props.style}
    >
      <For each={carouselItems()}>
        {(item, physicalIndex) =>
          props.children(item, {
            physicalIndex,
            logicalIndex: () => logicalIndex(physicalIndex()),
            isClone: () =>
              loops() &&
              (physicalIndex() < props.items.length ||
                physicalIndex() >= props.items.length * 2),
          })
        }
      </For>
    </div>
  );
}
