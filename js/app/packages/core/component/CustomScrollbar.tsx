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
  const [scrollVelocity, setScrollVelocity] = createSignal(0);
  const [isHovering, setIsHovering] = createSignal(false);

  const [scrollLabelVisible, setScrollLabelVisible] = createSignal(
    props.labelVisibilityDebounceMs === Infinity
  );

  const debouncedHideScrollLabel = debounce(
    () => setScrollLabelVisible(false),
    props.labelVisibilityDebounceMs ?? 300
  );

  let lastScrollTop = 0;
  let lastScrollTime = Date.now();
  let velocityTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const updateScrollMetrics = () => {
    const container = props.scrollContainer();
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;

    setScrollTop(scrollTop);
    setScrollHeight(scrollHeight);
    setClientHeight(clientHeight);
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
    const contentHeight = scrollHeight();

    let maxScroll = contentHeight;

    if (!props.reverse) {
      maxScroll -= containerHeight;
    }

    if (maxScroll <= 0) return 0;
    const thumbH = thumbHeight();

    // scrollTop is negative when reversed so adding to scrollHeight will
    // set the scrollTop to be the total scrollable space - the current scroll position
    const scrollOffset = props.reverse
      ? scrollTop() + scrollHeight()
      : scrollTop();

    return (scrollOffset / maxScroll) * (containerHeight - thumbH);
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

      // Calculate scroll velocity
      const now = Date.now();
      const timeDelta = now - lastScrollTime;
      const scrollDelta = Math.abs(container.scrollTop - lastScrollTop);
      const velocity = timeDelta > 0 ? scrollDelta / timeDelta : 0;

      lastScrollTop = container.scrollTop;
      lastScrollTime = now;

      setScrollVelocity(velocity);

      if (props.labelVisibilityDebounceMs !== Infinity) {
        setScrollLabelVisible(true);
        debouncedHideScrollLabel();
      }

      // Gradually reduce velocity - slower fade out
      if (velocityTimeoutId) clearTimeout(velocityTimeoutId);
      velocityTimeoutId = setTimeout(() => {
        setScrollVelocity((prev) => {
          const newVel = prev * 0.85;
          if (newVel < 0.05) return 0;
          setTimeout(() => setScrollVelocity(0), 100);
          return newVel;
        });
      }, 200);
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
      if (velocityTimeoutId) clearTimeout(velocityTimeoutId);
    });
  });

  // Handle mouse drag
  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const container = props.scrollContainer();
    if (!container) return;

    setIsDragging(true);
    setScrollStartTop(
      props.reverse
        ? container.scrollHeight + container.scrollTop
        : container.scrollTop
    );

    let isDraggingLocal = true;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingLocal) return;

      const deltaY = moveEvent.clientY - e.clientY;
      const trackH = clientHeight();
      const contentHeight = scrollHeight();

      let maxScroll = contentHeight;

      if (!props.reverse) {
        maxScroll -= trackH;
      }

      const thumbH = thumbHeight();

      const scrollRatio = deltaY / (trackH - thumbH);
      let newScrollTop = Math.max(
        0,
        Math.min(maxScroll, scrollStartTop() + scrollRatio * maxScroll)
      );

      if (props.reverse) {
        newScrollTop = newScrollTop - contentHeight;
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
    const contentHeight = scrollHeight();
    let maxScroll = contentHeight;

    if (!props.reverse) {
      maxScroll -= trackH;
    }

    const scrollRatio = clickY / trackH;
    let newScrollTop = Math.max(
      0,
      Math.min(maxScroll, scrollRatio * maxScroll)
    );

    if (props.reverse) {
      newScrollTop = newScrollTop - contentHeight;
    }

    container.scrollTop = newScrollTop;
    setScrollTop(newScrollTop);
  };

  const getThumbOpacity = () => {
    if (isDragging()) return 1;
    if (isHovering()) return 0.8;
    const vel = scrollVelocity();
    if (vel === 0) return 0;
    // Normalize velocity (0-5px/ms is typical fast scroll)
    const normalizedVel = Math.min(vel / 5, 1);
    return normalizedVel;
  };

  const getThumbTransform = () => {
    if (isDragging()) return 'scaleX(1.6)';
    const vel = scrollVelocity();
    if (vel === 0) return 'scaleX(1)';
    // Scale more aggressively with velocity - up to 2x width at high speeds
    const normalizedVel = Math.min(vel / 5, 1);
    return `scaleX(${1 + normalizedVel * 1.0})`;
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
          class="absolute right-0 cursor-grab active:cursor-grabbing transition-all duration-200 ease-out"
          style={{
            top: `${thumbTop()}px`,
            height: `${thumbHeight()}px`,
            width: '1px',
            'background-color': 'var(--color-accent)',
            'transform-origin': 'right center',
            opacity: getThumbOpacity(),
            transform: getThumbTransform(),
            'transition-property': 'opacity, transform',
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
            {props.getLabel?.(
              props.reverse ? scrollTop() + scrollHeight() : scrollTop()
            )}
          </div>
        </Show>
      </div>
    </Show>
  );
}
