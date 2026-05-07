import { createSignal, onCleanup, onMount } from 'solid-js';
import type { JSX } from 'solid-js';

const THUMB_WIDTH = 2;
const HIDE_DELAY = 500;
const GUTTER_WIDTH = 8;
const THUMB_HEIGHT = 200;
const THUMB_RADIUS = THUMB_WIDTH * 0.5;
const THUMB_INSET = (GUTTER_WIDTH - THUMB_WIDTH) * 0.5;

export function Scroll(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [visible, setVisible] = createSignal(false);
  const [translateY, setTranslateY] = createSignal(THUMB_INSET);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let contentRef!: HTMLDivElement;
  let gutterRef!: HTMLDivElement;
  let scrollRef!: HTMLDivElement;
  let maxScroll = 0;
  let maxTop = 0;

  function paint() {
    setTranslateY(THUMB_INSET + (maxScroll > 0 ? (scrollRef.scrollTop / maxScroll) * maxTop : 0));
  }

  function measure() {
    const sh = scrollRef.scrollHeight;
    const ch = scrollRef.clientHeight;
    maxScroll = Math.max(0, sh - ch);
    maxTop = Math.max(0, ch - THUMB_HEIGHT - THUMB_INSET * 2);
    paint();
  }

  function reveal() {
    setVisible(true);
    if (hideTimer) { clearTimeout(hideTimer); }
    hideTimer = setTimeout(() => setVisible(false), HIDE_DELAY);
  }

  function handleScroll() {
    paint();
    reveal();
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
    reveal();
    scrollToLocalY(e.offsetY);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!gutterRef.hasPointerCapture(e.pointerId)) { return; }
    // reveal();
    scrollToLocalY(e.offsetY);
  }

  onMount(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollRef);
    ro.observe(contentRef);
    onCleanup(() => {
      ro.disconnect();
      if (hideTimer) { clearTimeout(hideTimer); }
    });
  });

  return (
    <div
      {...props}
      style={{
        'position': 'relative',
        'min-height': '0',
        'min-width': '0',
        'height': '100%',
        'width': '100%',
      }}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          'scrollbar-width': 'none',
          'overflow-y': 'auto',
          'height': '100%',
        }}
      >
        <div ref={contentRef}>{props.children}</div>
      </div>
      <div
        ref={gutterRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        aria-hidden="true"
        style={{
          'width': `${GUTTER_WIDTH}px`,
          'touch-action': 'none',
          'position': 'absolute',
          'height': '100%',
          'right': '0',
          'top': '0',
        }}
      >
        <div
          style={{
            'transform': `translateY(${translateY()}px)`,
            'transition': 'opacity 150ms ease-in-out',
            'border-radius': `${THUMB_RADIUS}px`,
            'background-color': 'var(--c4)',
            'height': `${THUMB_HEIGHT}px`,
            'opacity': visible() ? 1 : 0,
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
