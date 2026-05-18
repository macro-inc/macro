import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';

interface CustomScrollbarProps {
  scrollContainer: () => HTMLElement | undefined;
  class?: string;
  getLabel?: (offset: number) => string | undefined;
  /** How long a label is visible for. Set to `Infinity` to keep the label visible at all times * */
  labelVisibilityDebounceMs?: number;
  labelClass?: string;
  enabled?: boolean;
  reverse?: boolean;
  horizontal?: boolean;
}

const MIN_THUMB_SIZE = 24;
const GUTTER_SIZE = 8;
const THUMB_INSET = 3;
const THUMB_THICKNESS = 2;
const EDGE_INSET = 3;

export function CustomScrollbar(props: CustomScrollbarProps) {
  return (
    <Show when={props.enabled ?? true} fallback={null}>
      <InnerCustomScrollbar {...props} />
    </Show>
  );
}

function InnerCustomScrollbar(props: CustomScrollbarProps) {
  const horiz = () => props.horizontal ?? false;

  const [scrollPos, setScrollPos] = createSignal(0);
  const [scrollSize, setScrollSize] = createSignal(0);
  const [clientSize, setClientSize] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isScrolling, setIsScrolling] = createSignal(false);

  const [scrollLabelVisible, setScrollLabelVisible] = createSignal(
    props.labelVisibilityDebounceMs === Infinity
  );

  const debouncedHideScrollLabel = debounce(
    () => setScrollLabelVisible(false),
    props.labelVisibilityDebounceMs ?? 300
  );

  const debouncedHideScrollbar = debounce(() => setIsScrolling(false), 500);

  const updateScrollMetrics = () => {
    const container = props.scrollContainer();
    if (!container) return;
    if (horiz()) {
      setScrollPos(container.scrollLeft);
      setScrollSize(container.scrollWidth);
      setClientSize(container.clientWidth);
    } else {
      setScrollPos(container.scrollTop);
      setScrollSize(container.scrollHeight);
      setClientSize(container.clientHeight);
    }
  };

  const maxScroll = () => Math.max(0, scrollSize() - clientSize());

  const trackSize = () => Math.max(0, clientSize() - THUMB_INSET * 2);

  const thumbSize = () => {
    const ts = trackSize();
    const ss = scrollSize();
    const ratio = ss > 0 ? clientSize() / ss : 1;
    return Math.max(MIN_THUMB_SIZE, Math.min(ts, ts * ratio));
  };

  const maxTop = () => Math.max(0, trackSize() - thumbSize());

  const scrollOffset = () => {
    const max = maxScroll();
    if (max <= 0) return 0;
    if (!props.reverse || horiz()) {
      return Math.max(0, Math.min(max, scrollPos()));
    }
    return Math.max(0, Math.min(max, max + scrollPos()));
  };

  const thumbOffset = () => {
    const max = maxScroll();
    if (max <= 0) return 0;
    return THUMB_INSET + (scrollOffset() / max) * maxTop();
  };

  const isVisible = () => scrollSize() > clientSize();

  createEffect(() => {
    const container = props.scrollContainer();
    if (!container) return;

    updateScrollMetrics();

    const handleScroll = () => {
      if (!isDragging()) updateScrollMetrics();
      setIsScrolling(true);
      debouncedHideScrollbar();
      if (props.labelVisibilityDebounceMs !== Infinity) {
        setScrollLabelVisible(true);
        debouncedHideScrollLabel();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollMetrics);
    resizeObserver.observe(container);

    onCleanup(() => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    });
  });

  const scrollToPointer = (clientPos: number, gutterRect: DOMRect) => {
    const container = props.scrollContainer();
    if (!container) return;
    const max = maxScroll();
    if (max <= 0) return;
    const mt = maxTop();
    if (mt <= 0) return;
    const start = horiz() ? gutterRect.left : gutterRect.top;
    const localPos = clientPos - start - thumbSize() / 2;
    const clamped = Math.max(0, Math.min(mt, localPos - THUMB_INSET));
    let newPos = (clamped / mt) * max;
    if (props.reverse && !horiz()) newPos = newPos - max;
    if (horiz()) {
      container.scrollLeft = newPos;
    } else {
      container.scrollTop = newPos;
    }
    setScrollPos(newPos);
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const gutter = e.currentTarget as HTMLElement;
    gutter.setPointerCapture(e.pointerId);
    setIsDragging(true);
    setIsScrolling(true);
    const rect = gutter.getBoundingClientRect();
    scrollToPointer(horiz() ? e.clientX : e.clientY, rect);
  };

  const handlePointerMove = (e: PointerEvent) => {
    const gutter = e.currentTarget as HTMLElement;
    if (!gutter.hasPointerCapture(e.pointerId)) return;
    setIsScrolling(true);
    debouncedHideScrollbar();
    const rect = gutter.getBoundingClientRect();
    scrollToPointer(horiz() ? e.clientX : e.clientY, rect);
  };

  const handlePointerUp = (e: PointerEvent) => {
    const gutter = e.currentTarget as HTMLElement;
    if (gutter.hasPointerCapture(e.pointerId)) {
      gutter.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
  };

  return (
    <Show when={isVisible()}>
      <div
        class={cn(
          'absolute pointer-events-auto',
          horiz() ? 'bottom-0 inset-x-0' : 'right-0 inset-y-0',
          props.class
        )}
        style={
          horiz()
            ? { height: `${GUTTER_SIZE}px`, 'touch-action': 'none' }
            : { width: `${GUTTER_SIZE}px`, 'touch-action': 'none' }
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-hidden="true"
      >
        {/* Thumb */}
        <div
          class="absolute"
          style={
            horiz()
              ? {
                  transform: `translateX(${thumbOffset()}px)`,
                  width: `${thumbSize()}px`,
                  height: `${THUMB_THICKNESS}px`,
                  bottom: `${EDGE_INSET}px`,
                  left: '0',
                  'background-color': 'var(--c4)',
                  'border-radius': '1px',
                  'pointer-events': 'none',
                  opacity: isDragging() || isScrolling() ? 1 : 0,
                  transition: 'opacity 150ms ease-in-out',
                }
              : {
                  transform: `translateY(${thumbOffset()}px)`,
                  height: `${thumbSize()}px`,
                  width: `${THUMB_THICKNESS}px`,
                  right: `${EDGE_INSET}px`,
                  top: '0',
                  'background-color': 'var(--c4)',
                  'border-radius': '1px',
                  'pointer-events': 'none',
                  opacity: isDragging() || isScrolling() ? 1 : 0,
                  transition: 'opacity 150ms ease-in-out',
                }
          }
        />
        <Show when={props.getLabel}>
          <div
            class={cn(
              'absolute right-[calc(100%+8px)] -translate-y-1/2 whitespace-nowrap font-mono text-sm text-accent pointer-events-none select-none drop-shadow transition-opacity duration-200 ease-out',
              props.labelClass
            )}
            style={{
              top: `${thumbOffset() + thumbSize() * 0.5}px`,
              opacity: scrollLabelVisible() ? 1 : 0,
            }}
          >
            {props.getLabel?.(scrollOffset())}
          </div>
        </Show>
      </div>
    </Show>
  );
}
