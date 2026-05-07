import { cn } from '@ui';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

const SCROLL_THRESHOLD = 20;

/**
 * Used to add decorative indications that content is scrollable, in scenarios where the scrollbar is hidden.
 * Supports both vertical (default) and horizontal scroll directions.
 */
export const ScrollIndicators = (props: {
  scrollRef: Accessor<HTMLElement | undefined>;
  direction?: 'vertical' | 'horizontal';
  noBorderStart?: boolean;
  noBorderEnd?: boolean;
}) => {
  const [startOpacity, setStartOpacity] = createSignal(0);
  const [endOpacity, setEndOpacity] = createSignal(0);

  const isHorizontal = () => props.direction === 'horizontal';

  const updateIndicators = () => {
    const ref = props.scrollRef();
    if (!ref) return;

    if (isHorizontal()) {
      const { scrollLeft, scrollWidth, clientWidth } = ref;
      setStartOpacity(
        Math.min(scrollLeft, SCROLL_THRESHOLD) / SCROLL_THRESHOLD
      );
      setEndOpacity(
        Math.min(scrollWidth - clientWidth - scrollLeft, SCROLL_THRESHOLD) /
          SCROLL_THRESHOLD
      );
    } else {
      const { scrollTop, scrollHeight, clientHeight } = ref;
      setStartOpacity(Math.min(scrollTop, SCROLL_THRESHOLD) / SCROLL_THRESHOLD);
      setEndOpacity(
        Math.min(scrollHeight - clientHeight - scrollTop, SCROLL_THRESHOLD) /
          SCROLL_THRESHOLD
      );
    }
  };

  createEffect(() => {
    const ref = props.scrollRef();
    if (!ref) return;

    ref.addEventListener('scroll', updateIndicators);

    const resizeObserver = new ResizeObserver(updateIndicators);
    resizeObserver.observe(ref);

    onCleanup(() => {
      ref.removeEventListener('scroll', updateIndicators);
      resizeObserver.disconnect();
    });

    updateIndicators();
  });

  return (
    <>
      {/* Start scroll boundary indicator */}
      <div
        class={cn(
          'absolute pointer-events-none z-annotation-layer pattern-diagonal-4 pattern-edge',
          isHorizontal()
            ? cn(
                'inset-y-px left-0 w-3 mask-r-from-0%',
                !props.noBorderStart && 'border-l border-edge-muted'
              )
            : cn(
                'inset-x-px top-0 h-3 mask-b-from-0%',
                !props.noBorderStart && 'border-t border-edge-muted'
              )
        )}
        style={{ opacity: startOpacity() }}
      />
      {/* End scroll boundary indicator */}
      <div
        class={cn(
          'absolute pointer-events-none z-annotation-layer pattern-diagonal-4 pattern-edge',
          isHorizontal()
            ? cn(
                'inset-y-px right-0 w-3 mask-l-from-0%',
                !props.noBorderEnd && 'border-r border-edge-muted'
              )
            : cn(
                'inset-x-px bottom-0 h-3 mask-t-from-0%',
                !props.noBorderEnd && 'border-b border-edge-muted'
              )
        )}
        style={{ opacity: endOpacity() }}
      />
    </>
  );
};
