import { isMobile } from '@core/mobile/isMobile';
import {
  createElementSize,
  makeResizeObserver,
} from '@solid-primitives/resize-observer';
import { type Accessor, createEffect, on, onMount } from 'solid-js';

// Matches the AI chat's own near-bottom threshold (see ChatMessages); larger
// than the channel list's 50 so streaming/keyboard reflow still re-pins.
const NEAR_BOTTOM_THRESHOLD = 100;

/**
 * Full-frame mobile: keep the AI chat pinned to the bottom across virtual
 * keyboard show/hide, when the user was already at the bottom. Two distinct
 * geometry changes move the bottom, so two observers:
 *
 * - The keyboard squishes the app (--dvh), shrinking the scroller while
 *   scrollTop stays put — the latest messages would slide behind the input.
 * - On dismissal the dock reappears and grows the wrapper's trailing inset
 *   (--mobile-content-inset-bottom, applied as padding-bottom), growing
 *   scrollHeight after the browser already clamped scrollTop — the view would
 *   rest slightly above the bottom.
 *
 * No-op off mobile (evaluated once at mount, matching the channel keyboard
 * handler).
 */
export function createMobileKeyboardScrollPin(opts: {
  /** The scroll container (the `[data-chat-scroll]` element). */
  scrollEl: Accessor<Element | null | undefined>;
  /** The messages wrapper that carries the trailing inset as padding. */
  wrapperEl: Accessor<HTMLElement | null | undefined>;
  scrollToBottom: (behavior: 'instant' | 'smooth') => void;
}): void {
  if (!isMobile()) return;
  const { scrollEl, wrapperEl, scrollToBottom } = opts;

  // Scroller shrink (keyboard appearing). "Was at bottom" is measured against
  // the pre-shrink height: after the resize the bottom has already moved up,
  // so a live near-bottom check would read false.
  const scrollerSize = createElementSize(scrollEl);
  createEffect(
    on(
      () => scrollerSize.height,
      (height, prevHeight) => {
        if (!height || !prevHeight || height >= prevHeight) return;
        const el = scrollEl();
        if (!el) return;
        const wasNearBottom =
          el.scrollTop + prevHeight >= el.scrollHeight - NEAR_BOTTOM_THRESHOLD;
        if (wasNearBottom) scrollToBottom('instant');
      }
    )
  );

  // Wrapper border-box growth (keyboard dismissing → dock inset restored).
  // Must observe the border-box: a content-box observer (createElementSize)
  // never sees a padding-only change, so it'd silently miss the dock's inset.
  onMount(() => {
    const wrapper = wrapperEl();
    if (!wrapper) return;
    let prevHeight = wrapper.getBoundingClientRect().height;
    const { observe } = makeResizeObserver(
      (entries) => {
        for (const entry of entries) {
          const height =
            entry.borderBoxSize?.[0]?.blockSize ??
            (entry.target as HTMLElement).offsetHeight;
          const grew = height - prevHeight;
          prevHeight = height;
          if (grew <= 0) continue;
          const el = scrollEl();
          if (!el) continue;
          // scrollHeight already includes the growth; compare against where
          // the bottom was before it.
          const wasNearBottom =
            el.scrollTop + el.clientHeight >=
            el.scrollHeight - grew - NEAR_BOTTOM_THRESHOLD;
          if (wasNearBottom) scrollToBottom('instant');
        }
      },
      { box: 'border-box' }
    );
    observe(wrapper);
  });
}
