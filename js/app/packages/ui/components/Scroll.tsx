import { createSignal, onCleanup, onMount, splitProps} from 'solid-js';
import type { JSX } from 'solid-js'

const THUMB_WIDTH = 2;
const GUTTER_WIDTH = 8;
const THUMB_HEIGHT = 200;
const THUMB_RADIUS = THUMB_WIDTH * 0.5;
const THUMB_INSET = (GUTTER_WIDTH - THUMB_WIDTH) * 0.5;

export function Scroll(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [isScrolling, setIsScrolling] = createSignal(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const [local, rest] = splitProps(props, ['children']);
  const [thumbTop, setThumbTop] = createSignal(0);
  let contentRef!: HTMLDivElement;
  let gutterRef!: HTMLDivElement;
  let scrollRef!: HTMLDivElement;
  let clientHeight = 0;
  let scrollHeight = 0;
  let maxScroll = 0;
  let maxTop = 0;
  let ratio = 0;

  function config() {
    scrollHeight = scrollRef.scrollHeight;
    clientHeight = scrollRef.clientHeight;
    maxScroll = Math.max(0, scrollHeight - clientHeight);
    maxTop = Math.max(0, clientHeight - THUMB_HEIGHT - THUMB_INSET * 2);
    ratio = maxScroll > 0 ? maxTop / maxScroll : 0;
    setThumbTop(THUMB_INSET + scrollRef.scrollTop * ratio);
  }

  const HIDE_DELAY = 500;
  let lastActivity = 0;

  function onHideTick() {
    const remaining = HIDE_DELAY - (performance.now() - lastActivity);
    if (remaining > 0) {
      hideTimer = setTimeout(onHideTick, remaining);
      return;
    }
    hideTimer = undefined;
    setIsScrolling(false);
  }

  function showThumb() {
    lastActivity = performance.now();
    if (!isScrolling()) { setIsScrolling(true); }
    if (hideTimer === undefined) {
      hideTimer = setTimeout(onHideTick, HIDE_DELAY);
    }
  }

  function handleScroll() {
    setThumbTop(THUMB_INSET + scrollRef.scrollTop * ratio);
    showThumb();
  }

  function scrollToLocalY(localY: number) {
    if (maxScroll <= 0 || maxTop <= 0) { return; }
    const centered = localY - THUMB_HEIGHT / 2 - THUMB_INSET;
    const clamped = Math.max(0, Math.min(maxTop, centered));
    scrollRef.scrollTop = (clamped / maxTop) * maxScroll;
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) { return; }
    e.preventDefault();
    gutterRef.setPointerCapture(e.pointerId);
    showThumb();
    scrollToLocalY(e.offsetY);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!gutterRef.hasPointerCapture(e.pointerId)) { return; }
    showThumb();
    scrollToLocalY(e.offsetY);
  }

  onMount(() => {
    config();

    const ro = new ResizeObserver(config);
    ro.observe(scrollRef);
    ro.observe(contentRef);

    onCleanup(() => {
      ro.disconnect();
      if (hideTimer) { clearTimeout(hideTimer); }
    });
  });

  return (
    <div
      {...rest}
      style={{
        'position': 'relative',
        'min-height': '0',
        'min-width': '0',
        'height': '100%',
        'width': '100%',
      }}
    >
      <div
        style={{
          'scrollbar-width': 'none',
          'overflow-y': 'auto',
          'height': '100%',
        }}
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div ref={contentRef}>
          {local.children}
        </div>
      </div>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        style={{
          'width': `${GUTTER_WIDTH}px`,
          'touch-action': 'none',
          'position': 'absolute',
          'height': '100%',
          'right': '0',
          'top': '0',
        }}
        aria-hidden="true"
        ref={gutterRef}
      >
        <div
          style={{
            'transform': `translateY(${thumbTop()}px)`,
            'transition': 'opacity 150ms ease-in-out',
            'border-radius': `${THUMB_RADIUS}px`,
            'opacity': isScrolling() ? 1 : 0,
            'background-color': 'var(--c4)',
            'height': `${THUMB_HEIGHT}px`,
            'right': `${THUMB_INSET}px`,
            'width': `${THUMB_WIDTH}px`,
            'pointer-events': 'none',
            'position': 'absolute',
          }}
        />
      </div>
    </div>
  );
}
