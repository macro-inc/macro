import { createSignal, onCleanup, onMount, splitProps, type JSX } from 'solid-js';
import { cn } from '../utils/classname';

export type ScrollProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  style?: JSX.CSSProperties;
};

const THUMB_HEIGHT = 120;

export function Scroll(props: ScrollProps) {
  const [local, rest] = splitProps(props, ['class', 'style', 'children']);

  let scrollRef!: HTMLDivElement;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const [thumbTop, setThumbTop] = createSignal(0);
  const [isScrolling, setIsScrolling] = createSignal(false);

  const update = () => {
    const el = scrollRef;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const maxTop = Math.max(0, clientHeight - THUMB_HEIGHT);
    setThumbTop(maxScroll > 0 ? (scrollTop / maxScroll) * maxTop : 0);
  };

  const handleScroll = () => {
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
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });

    onCleanup(() => {
      ro.disconnect();
      mo.disconnect();
      if (hideTimer) clearTimeout(hideTimer);
    });
  });

  return (
    <div class="relative size-full min-h-0 min-w-0" style={local.style}>
      <div
        ref={scrollRef}
        class={cn(
          'scrollbar-hidden relative size-full overflow-y-auto',
          local.class,
        )}
        onScroll={handleScroll}
        {...rest}
      >
        {local.children}
      </div>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute right-0 top-0 w-0.5 transition-opacity duration-200 ease-out"
        style={{
          'background-color': 'var(--a0)',
          transform: `translateY(${thumbTop()}px)`,
          height: `${THUMB_HEIGHT}px`,
          opacity: isScrolling() ? 1 : 0,
        }}
      />
    </div>
  );
}
