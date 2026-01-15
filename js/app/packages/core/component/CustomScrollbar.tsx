import { debounce } from '@solid-primitives/scheduled';
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
}

export function CustomScrollbar(props: CustomScrollbarProps) {
  return (
    <Show when={props.enabled ?? true} fallback={null}>
      <InnerCustomScrollbar {...props} />
    </Show>
  );
}

function InnerCustomScrollbar(props: CustomScrollbarProps) {
  const [scrollTop, setScrollTop] = createSignal(0);
  const [scrollHeight, setScrollHeight] = createSignal(0);
  const [clientHeight, setClientHeight] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [scrollStartTop, setScrollStartTop] = createSignal(0);
  const [isScrolling, setIsScrolling] = createSignal(false);
  const [isHovering, setIsHovering] = createSignal(false);

  const [scrollLabelVisible, setScrollLabelVisible] = createSignal(
    props.labelVisibilityDebounceMs === Infinity
  );

  const debouncedHideScrollLabel = debounce(
    () => setScrollLabelVisible(false),
    props.labelVisibilityDebounceMs ?? 300
  );

  const debouncedHideScrollbar = debounce(() => setIsScrolling(false), 800);

  const updateScrollMetrics = () => {
    const container = props.scrollContainer();
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;

    setScrollTop(scrollTop);
    setScrollHeight(scrollHeight);
    setClientHeight(clientHeight);
  };

  const maxScroll = () => Math.max(0, scrollHeight() - clientHeight());

  /**
   * Maps the container's scroll position to an offset measured from the top of
   * the content in the normal (non-reversed) coordinate space.
   *
   * When using reverse layouts (e.g. `flex-direction: column-reverse`), many
   * browsers report `scrollTop` in the range `[-maxScroll..0]`. In that case:
   * - at visual top: scrollTop === -maxScroll
   * - at visual bottom: scrollTop === 0
   *
   * We map that into [0..maxScroll] so the thumb can correctly reach the top.
   */
  const scrollOffsetFromTop = () => {
    const max = maxScroll();
    if (max <= 0) return 0;

    if (!props.reverse) {
      return Math.max(0, Math.min(max, scrollTop()));
    }

    // For reversed scrollTop in [-max..0], this converts to [0..max]
    return Math.max(0, Math.min(max, max + scrollTop()));
  };

  // Calculate scrollbar metrics
  function thumbHeight() {
    const containerHeight = clientHeight();
    const contentHeight = scrollHeight();
    if (contentHeight <= containerHeight) return 0;
    return Math.max(20, (containerHeight / contentHeight) * containerHeight);
  }
  const thumbTop = () => {
    const containerHeight = clientHeight();
    const max = maxScroll();
    if (max <= 0) return 0;
    const thumbH = thumbHeight();
    const trackSpace = Math.max(0, containerHeight - thumbH);
    const offset = scrollOffsetFromTop();
    return (offset / max) * trackSpace;
  };

  const isVisible = () => scrollHeight() > clientHeight();

  // Handle scroll events
  createEffect(() => {
    const container = props.scrollContainer();
    if (!container) return;

    updateScrollMetrics();

    const handleScroll = () => {
      if (!isDragging()) {
        updateScrollMetrics();
      }

      // Show scrollbar while scrolling, hide after delay
      setIsScrolling(true);
      debouncedHideScrollbar();

      if (props.labelVisibilityDebounceMs !== Infinity) {
        setScrollLabelVisible(true);
        debouncedHideScrollLabel();
      }
    };

    const handleResize = () => {
      updateScrollMetrics();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    onCleanup(() => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    });
  });

  // Handle mouse drag
  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const container = props.scrollContainer();
    if (!container) return;

    setIsDragging(true);
    // Store "offset from top" so dragging works consistently in reverse mode.
    setScrollStartTop(scrollOffsetFromTop());

    let isDraggingLocal = true;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingLocal) return;

      const deltaY = moveEvent.clientY - e.clientY;
      const trackH = clientHeight();
      const max = maxScroll();
      if (max <= 0) return;

      const thumbH = thumbHeight();
      const trackSpace = trackH - thumbH;
      if (trackSpace <= 0) return;

      const scrollRatio = deltaY / trackSpace;
      let newScrollTop = Math.max(
        0,
        Math.min(max, scrollStartTop() + scrollRatio * max)
      );

      if (props.reverse) {
        // Convert [0..max] back into [-max..0] for reversed layouts.
        newScrollTop = newScrollTop - max;
      }

      container.scrollTop = newScrollTop;
      setScrollTop(newScrollTop);
    };

    const handleMouseUp = () => {
      isDraggingLocal = false;
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Handle track click
  const handleTrackClick = (e: MouseEvent) => {
    const container = props.scrollContainer();
    if (!container) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const trackH = clientHeight();
    const max = maxScroll();
    if (max <= 0) return;

    const scrollRatio = clickY / trackH;
    let newScrollTop = Math.max(0, Math.min(max, scrollRatio * max));

    if (props.reverse) {
      newScrollTop = newScrollTop - max;
    }

    container.scrollTop = newScrollTop;
    setScrollTop(newScrollTop);
  };

  const getThumbOpacity = () => {
    if (isDragging()) return 1;
    if (isHovering()) return 1;
    if (isScrolling()) return 1;
    return 0;
  };

  const getThumbScale = () => {
    if (isDragging()) return 'scaleX(4)';
    if (isHovering()) return 'scaleX(2)';
    if (isScrolling()) return 'scaleX(2)';
    return 'scaleX(1)';
  };

  return (
    <Show when={isVisible()}>
      <div
        class={`absolute right-0 top-0 bottom-0 w-[1px] pointer-events-auto overflow-visible bg-transparent ${props.class || ''}`}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Track */}
        <div
          class="absolute inset-0 cursor-pointer bg-transparent"
          onClick={handleTrackClick}
        />
        {/* Thumb */}
        <div
          class="absolute right-0 cursor-grab active:cursor-grabbing"
          style={{
            top: `${thumbTop()}px`,
            height: `${thumbHeight()}px`,
            width: '1px',
            'background-color': 'var(--color-accent)',
            'transform-origin': 'right center',
            opacity: getThumbOpacity(),
            transform: getThumbScale(),
            transition: 'opacity 200ms ease-out, transform 200ms ease-out',
          }}
          onMouseDown={handleMouseDown}
        />
        <Show when={props.getLabel}>
          <div
            class={`absolute right-[calc(100%+8px)] -translate-y-1/2 whitespace-nowrap font-mono text-sm text-accent pointer-events-none select-none drop-shadow transition-opacity duration-200 ease-out ${props.labelClass || ''}`}
            style={{
              top: `${thumbTop() + thumbHeight() / 2}px`,
              opacity: scrollLabelVisible() ? 1 : 0,
            }}
          >
            {props.getLabel?.(scrollOffsetFromTop())}
          </div>
        </Show>
      </div>
    </Show>
  );
}
