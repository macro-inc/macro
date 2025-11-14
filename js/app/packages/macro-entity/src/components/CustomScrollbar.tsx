import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';

interface CustomScrollbarProps {
  scrollContainer: () => HTMLElement | undefined;
  class?: string;
}

export function CustomScrollbar(props: CustomScrollbarProps) {
  const [scrollTop, setScrollTop] = createSignal(0);
  const [scrollHeight, setScrollHeight] = createSignal(0);
  const [clientHeight, setClientHeight] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [scrollStartTop, setScrollStartTop] = createSignal(0);
  const [scrollVelocity, setScrollVelocity] = createSignal(0);
  const [isHovering, setIsHovering] = createSignal(false);
  let lastScrollTop = 0;
  let lastScrollTime = Date.now();
  let velocityTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const updateScrollMetrics = () => {
    const container = props.scrollContainer();
    if (!container) return;

    setScrollTop(container.scrollTop);
    setScrollHeight(container.scrollHeight);
    setClientHeight(container.clientHeight);
  };

  // Calculate scrollbar metrics
  const thumbHeight = () => {
    const containerHeight = clientHeight();
    const contentHeight = scrollHeight();
    if (contentHeight <= containerHeight) return 0;
    return Math.max(20, (containerHeight / contentHeight) * containerHeight);
  };
  const thumbTop = () => {
    const containerHeight = clientHeight();
    const contentHeight = scrollHeight();
    const maxScroll = contentHeight - containerHeight;
    if (maxScroll <= 0) return 0;
    const thumbH = thumbHeight();
    return (scrollTop() / maxScroll) * (containerHeight - thumbH);
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
    setScrollStartTop(container.scrollTop);

    let isDraggingLocal = true;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingLocal) return;

      const deltaY = moveEvent.clientY - e.clientY;
      const trackH = clientHeight();
      const contentHeight = scrollHeight();
      const maxScroll = contentHeight - trackH;
      const thumbH = thumbHeight();

      const scrollRatio = deltaY / (trackH - thumbH);
      const newScrollTop = Math.max(
        0,
        Math.min(maxScroll, scrollStartTop() + scrollRatio * maxScroll)
      );

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
    const maxScroll = contentHeight - trackH;

    const scrollRatio = clickY / trackH;
    const newScrollTop = Math.max(
      0,
      Math.min(maxScroll, scrollRatio * maxScroll)
    );

    container.scrollTop = newScrollTop;
    setScrollTop(newScrollTop);
  };

  return (
    <Show when={isVisible()}>
      <div
        class={`absolute right-0 top-0 bottom-0 w-[2px] pointer-events-auto ${props.class || ''}`}
        style={{
          'background-color': 'transparent',
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Track */}
        <div
          class="absolute inset-0 cursor-pointer"
          onClick={handleTrackClick}
          style={{
            'background-color': 'transparent',
          }}
        />
        {/* Thumb */}
        <div
          class="absolute right-0 cursor-grab active:cursor-grabbing transition-all duration-200 ease-out"
          style={{
            top: `${thumbTop()}px`,
            height: `${thumbHeight()}px`,
            width: '2px',
            'background-color': 'var(--color-accent)',
            opacity: (() => {
              if (isDragging()) return 1;
              if (isHovering()) return 0.8;
              const vel = scrollVelocity();
              if (vel === 0) return 0;
              // Normalize velocity (0-5px/ms is typical fast scroll)
              const normalizedVel = Math.min(vel / 5, 1);
              return normalizedVel;
            })(),
            'box-shadow': (() => {
              if (isDragging()) {
                return '0 0 8px oklch(from var(--color-accent) l c h / 0.6), 0 0 4px oklch(from var(--color-accent) l c h / 0.4)';
              }
              const vel = scrollVelocity();
              if (vel === 0) return 'none';
              const normalizedVel = Math.min(vel / 5, 1);
              const glowOpacity = normalizedVel * 0.6;
              const glowOpacity2 = normalizedVel * 0.4;
              return `0 0 ${8 * normalizedVel}px oklch(from var(--color-accent) l c h / ${glowOpacity}), 0 0 ${4 * normalizedVel}px oklch(from var(--color-accent) l c h / ${glowOpacity2})`;
            })(),
            transform: (() => {
              if (isDragging()) return 'scaleX(1.6)';
              const vel = scrollVelocity();
              if (vel === 0) return 'scaleX(1)';
              // Scale more aggressively with velocity - up to 2x width at high speeds
              const normalizedVel = Math.min(vel / 5, 1);
              return `scaleX(${1 + normalizedVel * 1.0})`;
            })(),
            'transition-property': 'opacity, box-shadow, transform',
          }}
          onMouseDown={handleMouseDown}
        />
      </div>
    </Show>
  );
}

