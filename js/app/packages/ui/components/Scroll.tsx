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
  let rafId: number | undefined;
  let clientHeight = 0;
  let scrollHeight = 0;

  function update() {
    const scrollTop = scrollRef.scrollTop;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const maxTop = Math.max(0, clientHeight - THUMB_HEIGHT - THUMB_INSET * 2);
    const offset = maxScroll > 0 ? (scrollTop / maxScroll) * maxTop : 0;
    setThumbTop(THUMB_INSET + offset);
  }

  function config() {
    scrollHeight = scrollRef.scrollHeight;
    clientHeight = scrollRef.clientHeight;
    update();
  }

  function scheduleUpdate() {
    if (rafId !== undefined) { return; }
    rafId = requestAnimationFrame(() => {
      rafId = undefined;
      update();
    });
  }

  function showThumb() {
    setIsScrolling(true);
    if (hideTimer) { clearTimeout(hideTimer); }
    hideTimer = setTimeout(() => setIsScrolling(false), 500);
  }

  function handleScroll() {
    scheduleUpdate();
    showThumb();
  }

  function scrollToLocalY(localY: number) {
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    if (maxScroll <= 0) { return; }
    const maxTop = Math.max(0, clientHeight - THUMB_HEIGHT - THUMB_INSET * 2);
    if (maxTop <= 0) { return; }
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
      if (rafId !== undefined) { cancelAnimationFrame(rafId); }
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
