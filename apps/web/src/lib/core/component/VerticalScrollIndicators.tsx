import { cn } from '@ui';
import { type Accessor, createEffect, onCleanup } from 'solid-js';

const SCROLL_THRESHOLD = 20;

const GRADIENT_COLOR = {
  surface: 'var(--color-surface)',
  panel: 'var(--color-panel)',
  page: 'var(--color-page)',
  inset: 'var(--color-inset)',
  dialog: 'var(--color-dialog)',
  menu: 'var(--color-menu)',
} as const;

/** Fade start color for `appearance="gradient"`. Defaults to surface. */
export type ScrollIndicatorGradientColor = keyof typeof GRADIENT_COLOR;

function thresholdOpacity(distance: number) {
  return Math.max(0, Math.min(distance, SCROLL_THRESHOLD) / SCROLL_THRESHOLD);
}

/**
 * Adds decorative indications that content is scrollable. The indicators hide
 * at their respective scroll boundaries and support vertical or horizontal
 * scrolling.
 */
export const ScrollIndicators = (props: {
  scrollRef: Accessor<HTMLElement | undefined>;
  direction?: 'vertical' | 'horizontal';
  appearance?: 'pattern' | 'gradient';
  gradientColor?: ScrollIndicatorGradientColor;
  class?: string;
  noBorderStart?: boolean;
  noBorderEnd?: boolean;
}) => {
  let startIndicator: HTMLDivElement | undefined;
  let endIndicator: HTMLDivElement | undefined;

  const isHorizontal = () => props.direction === 'horizontal';
  const isGradient = () => props.appearance === 'gradient';
  const gradientColor = () => GRADIENT_COLOR[props.gradientColor ?? 'surface'];
  const gradientStyle = () =>
    isGradient() ? { '--scroll-indicator-from': gradientColor() } : undefined;

  const updateIndicators = () => {
    const ref = props.scrollRef();
    if (!ref || !startIndicator || !endIndicator) return;

    if (isHorizontal()) {
      const { scrollLeft, scrollWidth, clientWidth } = ref;
      startIndicator.style.opacity = String(thresholdOpacity(scrollLeft));
      endIndicator.style.opacity = String(
        thresholdOpacity(scrollWidth - clientWidth - scrollLeft)
      );
    } else {
      const { scrollTop, scrollHeight, clientHeight } = ref;
      startIndicator.style.opacity = String(thresholdOpacity(scrollTop));
      endIndicator.style.opacity = String(
        thresholdOpacity(scrollHeight - clientHeight - scrollTop)
      );
    }
  };

  createEffect(() => {
    const ref = props.scrollRef();
    if (!ref) return;

    ref.addEventListener('scroll', updateIndicators, { passive: true });

    const resizeObserver = new ResizeObserver(updateIndicators);
    resizeObserver.observe(ref);
    const observeScrollContent = () => {
      const content = ref.firstElementChild;
      if (content instanceof HTMLElement) resizeObserver.observe(content);
    };
    observeScrollContent();

    updateIndicators();

    onCleanup(() => {
      ref.removeEventListener('scroll', updateIndicators);
      resizeObserver.disconnect();
    });
  });

  return (
    <>
      <div
        ref={startIndicator}
        aria-hidden="true"
        style={gradientStyle()}
        class={cn(
          'pointer-events-none absolute z-annotation-layer',
          isGradient()
            ? isHorizontal()
              ? 'inset-y-0 left-0 w-4 bg-linear-to-r from-(--scroll-indicator-from) to-transparent transition-opacity'
              : 'inset-x-0 top-0 h-4 bg-linear-to-b from-(--scroll-indicator-from) to-transparent transition-opacity'
            : isHorizontal()
              ? cn(
                  'inset-y-px left-0 w-3 mask-r-from-0% pattern-diagonal-4 pattern-edge',
                  !props.noBorderStart && 'border-edge-muted border-l'
                )
              : cn(
                  'inset-x-px top-0 h-3 mask-b-from-0% pattern-diagonal-4 pattern-edge',
                  !props.noBorderStart && 'border-edge-muted border-t'
                ),
          props.class
        )}
      />
      <div
        ref={endIndicator}
        aria-hidden="true"
        style={gradientStyle()}
        class={cn(
          'pointer-events-none absolute z-annotation-layer',
          isGradient()
            ? isHorizontal()
              ? 'inset-y-0 right-0 w-4 bg-linear-to-l from-(--scroll-indicator-from) to-transparent transition-opacity'
              : 'inset-x-0 bottom-0 h-4 bg-linear-to-t from-(--scroll-indicator-from) to-transparent transition-opacity'
            : isHorizontal()
              ? cn(
                  'inset-y-px right-0 w-3 mask-l-from-0% pattern-diagonal-4 pattern-edge',
                  !props.noBorderEnd && 'border-edge-muted border-r'
                )
              : cn(
                  'inset-x-px bottom-0 h-3 mask-t-from-0% pattern-diagonal-4 pattern-edge',
                  !props.noBorderEnd && 'border-edge-muted border-b'
                ),
          props.class
        )}
      />
    </>
  );
};
