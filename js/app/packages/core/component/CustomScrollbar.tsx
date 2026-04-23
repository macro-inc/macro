import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui/utils/classname';
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
  const [scrollStart, setScrollStart] = createSignal(0);
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

  const scrollOffset = () => {
    const max = maxScroll();
    if (max <= 0) return 0;
    if (!props.reverse || horiz()) {
      return Math.max(0, Math.min(max, scrollPos()));
    }
    return Math.max(0, Math.min(max, max + scrollPos()));
  };

  const thumbSize = () => {
    const cSize = clientSize();
    const sSize = scrollSize();
    if (sSize <= cSize) return 0;
    return Math.max(20, (cSize / sSize) * cSize);
  };

  const thumbOffset = () => {
    const cSize = clientSize();
    const max = maxScroll();
    if (max <= 0) return 0;
    const tSize = thumbSize();
    const trackSpace = Math.max(0, cSize - tSize);
    return (scrollOffset() / max) * trackSpace;
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

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const container = props.scrollContainer();
    if (!container) return;

    setIsDragging(true);
    setScrollStart(scrollOffset());

    let isDraggingLocal = true;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingLocal) return;

      const delta = horiz()
        ? moveEvent.clientX - e.clientX
        : moveEvent.clientY - e.clientY;
      const trackSize = clientSize();
      const max = maxScroll();
      if (max <= 0) return;

      const tSize = thumbSize();
      const trackSpace = trackSize - tSize;
      if (trackSpace <= 0) return;

      const scrollRatio = delta / trackSpace;
      let newPos = Math.max(
        0,
        Math.min(max, scrollStart() + scrollRatio * max)
      );

      if (props.reverse && !horiz()) newPos = newPos - max;

      if (horiz()) {
        container.scrollLeft = newPos;
      } else {
        container.scrollTop = newPos;
      }
      setScrollPos(newPos);
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

  const handleTrackClick = (e: MouseEvent) => {
    const container = props.scrollContainer();
    if (!container) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickPos = horiz() ? e.clientX - rect.left : e.clientY - rect.top;
    const trackSize = horiz() ? rect.width : rect.height;
    const max = maxScroll();
    if (max <= 0) return;

    const scrollRatio = clickPos / trackSize;
    let newPos = Math.max(0, Math.min(max, scrollRatio * max));

    if (props.reverse && !horiz()) newPos = newPos - max;

    if (horiz()) {
      container.scrollLeft = newPos;
    } else {
      container.scrollTop = newPos;
    }
    setScrollPos(newPos);
  };

  const getThumbOpacity = () => {
    if (isDragging()) return 1;
    if (isHovering()) return 1;
    if (isScrolling()) return 1;
    return 0;
  };

  const getThumbScale = () => {
    if (horiz()) {
      if (isDragging()) return 'scaleY(4)';
      if (isHovering()) return 'scaleY(2)';
      if (isScrolling()) return 'scaleY(2)';
      return 'scaleY(1)';
    }
    if (isDragging()) return 'scaleX(4)';
    if (isHovering()) return 'scaleX(2)';
    if (isScrolling()) return 'scaleX(2)';
    return 'scaleX(1)';
  };

  return (
    <Show when={isVisible()}>
      <div
        class={cn(
          'absolute pointer-events-auto overflow-visible bg-transparent',
          horiz()
            ? 'bottom-0 left-0 right-0 h-[1px]'
            : 'right-0 top-0 bottom-0 w-[1px]',
          props.class
        )}
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
          class="absolute cursor-grab active:cursor-grabbing"
          style={
            horiz()
              ? {
                  left: `${thumbOffset()}px`,
                  width: `${thumbSize()}px`,
                  height: '1px',
                  bottom: '0',
                  'background-color': 'var(--color-accent)',
                  'transform-origin': 'center bottom',
                  opacity: getThumbOpacity(),
                  transform: getThumbScale(),
                  transition:
                    'opacity 200ms ease-out, transform 200ms ease-out',
                }
              : {
                  top: `${thumbOffset()}px`,
                  height: `${thumbSize()}px`,
                  width: '1px',
                  right: '0',
                  'background-color': 'var(--color-accent)',
                  'transform-origin': 'right center',
                  opacity: getThumbOpacity(),
                  transform: getThumbScale(),
                  transition:
                    'opacity 200ms ease-out, transform 200ms ease-out',
                }
          }
          onMouseDown={handleMouseDown}
        />
        <Show when={props.getLabel}>
          <div
            class={cn(
              'absolute right-[calc(100%+8px)] -translate-y-1/2 whitespace-nowrap font-mono text-sm text-accent pointer-events-none select-none drop-shadow transition-opacity duration-200 ease-out',
              props.labelClass
            )}
            style={{
              top: `${thumbOffset() + thumbSize() / 2}px`,
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
