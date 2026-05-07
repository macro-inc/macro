import { createSignal, onCleanup, onMount, splitProps} from 'solid-js';
import { cn } from '../utils/classname';
import type { JSX } from 'solid-js'

const THUMB_HEIGHT = 200;
const GUTTER_WIDTH = 8;
const THUMB_INSET = 3;

export function Scroll(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const [isScrolling, setIsScrolling] = createSignal(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const [thumbTop, setThumbTop] = createSignal(0);
  let gutterRef!: HTMLDivElement;
  let scrollRef!: HTMLDivElement;

  function update() {
    const { scrollTop, scrollHeight, clientHeight } = scrollRef;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const maxTop = Math.max(0, clientHeight - THUMB_HEIGHT - THUMB_INSET * 2);
    const offset = maxScroll > 0 ? (scrollTop / maxScroll) * maxTop : 0;
    setThumbTop(THUMB_INSET + offset);
  }

  function showThumb() {
    setIsScrolling(true);
    if (hideTimer) { clearTimeout(hideTimer); }
    hideTimer = setTimeout(() => setIsScrolling(false), 500);
  }

  function handleScroll() {
    update();
    showThumb();
  }

  function scrollToPointer(clientY: number) {
    const rect = gutterRef.getBoundingClientRect();
    const { scrollHeight, clientHeight } = scrollRef;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    if (maxScroll <= 0) { return; }
    const maxTop = Math.max(0, clientHeight - THUMB_HEIGHT - THUMB_INSET * 2);
    if (maxTop <= 0) { return; }
    const localY = clientY - rect.top - THUMB_HEIGHT / 2;
    const clamped = Math.max(0, Math.min(maxTop, localY - THUMB_INSET));
    scrollRef.scrollTop = (clamped / maxTop) * maxScroll;
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) { return; }
    e.preventDefault();
    gutterRef.setPointerCapture(e.pointerId);
    showThumb();
    scrollToPointer(e.clientY);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!gutterRef.hasPointerCapture(e.pointerId)) { return; }
    showThumb();
    scrollToPointer(e.clientY);
  }

  function handlePointerUp(e: PointerEvent) {
    if (gutterRef.hasPointerCapture(e.pointerId)) {
      gutterRef.releasePointerCapture(e.pointerId);
    }
  }

  onMount(() => {
    update();

    const ro = new ResizeObserver(update);
    ro.observe(scrollRef);

    const mo = new MutationObserver(update);
    mo.observe(scrollRef, {
      characterData: true,
      attributes: true,
      childList: true,
      subtree: true,
    });

    onCleanup(() => {
      ro.disconnect();
      mo.disconnect();
      if (hideTimer) { clearTimeout(hideTimer); }
    });
  });

  return (
    <div
      {...rest}
      class={cn('relative h-full min-h-0 w-full min-w-0', local.class)}
    >
      <div
        style={{
          'scrollbar-width': 'none',
          'position': 'relative',
          'overflow-y': 'auto',
          'height': '100%',
          'width': '100%',
        }}
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {local.children}
      </div>
      <div
        onPointerCancel={handlePointerUp}
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
        onPointerUp={handlePointerUp}
        aria-hidden="true"
        ref={gutterRef}
      >
        <div
          style={{
            'transform': `translateY(${thumbTop()}px)`,
            'transition': 'opacity 150ms ease-in-out',
            'opacity': isScrolling() ? 1 : 0,
            'background-color': 'var(--c4)',
            'height': `${THUMB_HEIGHT}px`,
            'pointer-events': 'none',
            'border-radius': '1px',
            'position': 'absolute',
            'width': '2px',
            'right': '3px',
            'top': '0',
          }}
        />
      </div>
    </div>
  );
}
