import { cn } from '@ui/utils/classname';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

const SCROLL_THRESHOLD = 20;

/**
 * Used to add decorative indications that content is scrollable, in scenarios where the scrollbar is hidden.
 */
export const VerticalScrollIndicators = (props: {
  scrollRef: Accessor<HTMLElement | undefined>;
  noBorderTop?: boolean;
  noBorderBottom?: boolean;
}) => {
  const [topOpacity, setTopOpacity] = createSignal(0);
  const [bottomOpacity, setBottomOpacity] = createSignal(0);

  const updateIndicators = () => {
    const ref = props.scrollRef();
    if (!ref) return;
    const { scrollTop, scrollHeight, clientHeight } = ref;

    const topAmount = Math.min(scrollTop, SCROLL_THRESHOLD);
    setTopOpacity(topAmount / SCROLL_THRESHOLD);

    const maxScroll = scrollHeight - clientHeight;
    const remainingScroll = maxScroll - scrollTop;
    const bottomAmount = Math.min(remainingScroll, SCROLL_THRESHOLD);
    setBottomOpacity(bottomAmount / SCROLL_THRESHOLD);
  };

  createEffect(() => {
    const ref = props.scrollRef();
    if (!ref) return;

    ref.addEventListener('scroll', updateIndicators);

    // Watch for content size changes (e.g. recipients added/removed)
    const resizeObserver = new ResizeObserver(updateIndicators);
    resizeObserver.observe(ref);

    onCleanup(() => {
      ref.removeEventListener('scroll', updateIndicators);
      resizeObserver.disconnect();
    });

    // Initial calculation
    updateIndicators();
  });

  return (
    <>
      {/* Top scroll boundary indicator */}
      <div
        class={cn(
          'absolute pointer-events-none left-px right-px top-0 h-3 z-2 pattern-diagonal-4 pattern-edge mask-b-from-0%',
          !props.noBorderTop && 'border-t border-edge-muted'
        )}
        style={{ opacity: topOpacity() }}
      />
      {/* Bottom scroll boundary indicator */}
      <div
        class={cn(
          'absolute pointer-events-none left-px right-px bottom-0 h-3 z-2 pattern-diagonal-4 pattern-edge mask-t-from-0% ',
          !props.noBorderBottom && 'border-b border-edge-muted'
        )}
        style={{ opacity: bottomOpacity() }}
      />
    </>
  );
};
