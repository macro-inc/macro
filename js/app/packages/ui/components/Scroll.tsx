import { createSignal, onCleanup, onMount, splitProps, type JSX } from 'solid-js';

export type ScrollProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  style?: JSX.CSSProperties;
};

const THUMB_HEIGHT = 200;
const THUMB_INSET = 3;

export function Scroll(props: ScrollProps) {
  const [local, rest] = splitProps(props, ['children', 'style']);

  let scrollRef!: HTMLDivElement;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const [thumbTop, setThumbTop] = createSignal(0);
  const [isScrolling, setIsScrolling] = createSignal(false);

  function update() {
    const el = scrollRef;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const maxTop = Math.max(0, clientHeight - THUMB_HEIGHT - THUMB_INSET * 2);
    const offset = maxScroll > 0 ? (scrollTop / maxScroll) * maxTop : 0;
    setThumbTop(THUMB_INSET + offset);
  };

  function handleScroll() {
    update();
    setIsScrolling(true);
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setIsScrolling(false), 800);
  };

  onMount(() => {
    update();

    const ro = new ResizeObserver(update);
    ro.observe(scrollRef);

    // Catch content size changes (e.g. children added/removed/resized).
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
      if (hideTimer) clearTimeout(hideTimer);
    });
  });

  return (
    <div
      {...rest}
      style={{
        'position': 'relative',
        'min-height': '0',
        'height': '100%',
        'min-width': '0',
        'width': '100%',
        ...local.style,
      }}
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
        aria-hidden="true"
        style={{
          'transform': `translateY(${thumbTop()}px)`,
          'transition': 'opacity 200ms ease-out',
          'opacity': isScrolling() ? 1 : 0,
          'background-color': 'var(--a0)',
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
  );
}
