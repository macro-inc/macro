import { type ParentProps, Suspense } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';

export function UtilWrap(props: ParentProps) {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        'grid-template-columns':
          viewportWidth() < 700
            ? 'minmax(var(--page-gutter), 1fr) minmax(0, var(--page-max-mobile)) minmax(var(--page-gutter), 1fr)'
            : 'minmax(var(--page-gutter), 1fr) minmax(0, var(--page-max)) minmax(var(--page-gutter), 1fr)',
        display: 'grid',
        // Horizontal-overflow guard for every route. Decorative bleed elements
        // (full-bleed hero backdrops, radial glows with negative `inset`) can
        // poke a few px past the viewport edge. #app-scroll-root carries
        // overflow-x: hidden, but iOS Safari does not reliably clip the cross
        // axis of a *scroll container* (overflow-y: scroll) — the bleed then
        // makes the page lay out wider than the screen, and vw/`100%` sizing
        // (13vw headline, 100vw washes) resolve against that inflated width, so
        // content shifts right and clips off-screen. This div is not a scroll
        // container, so `overflow-x: clip` here is honored by every engine (and,
        // unlike `hidden`, doesn't establish a scroll container that would break
        // sticky descendants or capture the fixed header). It sits at the real
        // viewport width, so it only trims what genuinely exceeds the screen.
        // `position: relative` is required for WebKit/Safari: it does not clip an
        // absolutely-positioned descendant (e.g. the full-bleed hero backdrop's
        // `position:absolute; transform: translateX(-50%); width:100vw` layers) at
        // an `overflow: clip` ancestor unless that ancestor is itself a positioned
        // containing block. Without this, those layers escape the clip in Safari
        // and inflate the page, shifting the hero right on the home + feature pages.
        position: 'relative',
        'overflow-x': 'clip',
        width: '100%',
      }}
    >
      <div />
      <div class="marketing-content">
        <Suspense>{props.children}</Suspense>
      </div>
      <div />
    </div>
  );
}
